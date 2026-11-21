import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
  type RouteHandlerMethod,
} from "fastify";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import apiReference from "@scalar/fastify-api-reference";
import type { MapFeature, RichText, TextDir } from "@livemap/core";
import type { MapDraft, MapPatch, MapRepo, RepoCtx } from "./repo.js";
import type { ArtifactStore } from "./storage.js";
import { publishMap, rollbackMap, type PublishOutcome } from "./publish.js";
import { can, capabilitiesOf } from "./authz.js";
import {
  DEFAULT_LIMITS,
  GUEST_TTL_SECS,
  isGuestSlug,
  limitsFor,
  type Limits,
  type RateLimits,
} from "./limits.js";
import { BLANK_VIEWPORT, TEMPLATES, findTemplate } from "./templates.js";
import type { GuestProvisioner } from "./guests.js";
import type { HumanCheck } from "./turnstile.js";
import type { SessionClaims } from "./auth.js";
import {
  CREATE_BODY,
  EDIT_APPLIED,
  EDIT_BODY,
  ERROR,
  GUEST_BODY,
  GUEST_CREATED,
  LIST_QUERY,
  MAP_PARAMS,
  OK,
  PATCH_BODY,
  ROLLBACK_BODY,
} from "./schemas.js";
import { DOCS_CSS } from "./docs-theme.js";

/**
 * Extends RepoCtx rather than restating it, so an actor is directly usable as
 * a repo context. That is what lets every handler pass `actor` straight down
 * and have app.tenant_id, app.user_id and app.role all get set — the GUCs the
 * policies in migrations/0002_role_aware_rls.sql read.
 */
export interface Actor extends RepoCtx {
  readonly tenantSlug: string;
  /** Unix seconds. Present when the credential itself expires. */
  readonly expiresAt?: number;
}

export interface AuthResolver {
  /** Return null to reject with 401. */
  resolve(req: FastifyRequest): Promise<Actor | null>;
}

/** Everything guest signup needs. Leave it out and the route does not exist. */
export interface GuestSignup {
  readonly provisioner: GuestProvisioner;
  /** Kept as a function so the server never holds the signing secret. */
  readonly issueToken: (claims: SessionClaims) => string;
  readonly ttlSecs?: number;
  /**
   * The public half of the human check, handed to the sign-in page through
   * `/config`. Present exactly when `humanCheck` is.
   */
  readonly humanCheckSiteKey?: string;
  /**
   * Signup is refused once this many guest tenants exist, expired ones
   * included. Reaping is an external job; this is what bounds the damage on
   * the day it is not running.
   */
  readonly maxGuests?: number;
  /** Omit in development and tests; in production an unset check is an open door. */
  readonly humanCheck?: HumanCheck;
}

export interface ServerDeps {
  readonly repo: MapRepo;
  readonly store: ArtifactStore;
  readonly auth: AuthResolver;
  readonly logger?: FastifyServerOptions["logger"];
  /** Tiers left out are unlimited. */
  readonly rateLimit?: Partial<RateLimits>;
  readonly limits?: Limits;
  /** Largest body accepted from anyone. Defaults to 2 MB. */
  readonly bodyLimit?: number;
  /** Checked by GET /ready. Omit and readiness is just liveness. */
  readonly readiness?: () => Promise<boolean>;
  /**
   * Replaces the default JSON 404. Fastify allows only one per prefix, so a
   * caller that wants to serve static pages from the fallback has to supply it
   * here rather than calling `setNotFoundHandler` on the returned instance.
   */
  readonly notFound?: RouteHandlerMethod;
  /**
   * Serve artifacts from the store at `/public/*`. For local development, the
   * demo and tests, where there is no CDN in front. Leave it off in production:
   * there it would be an unauthenticated proxy onto the bucket, on the one
   * process that also holds the database pool.
   */
  readonly servePublic?: boolean;
  /**
   * Where readers fetch artifacts from, without a trailing slash — the CDN in
   * production. Defaults to this server's own `/public`. Reported by `/me` so
   * the shell can build viewer and embed URLs without being configured twice.
   */
  readonly publicArtifactBase?: string;
  readonly guests?: GuestSignup;
  /**
   * Addresses whose `X-Forwarded-For` is believed. Without it every request
   * behind a proxy appears to come from the proxy, and each per-IP limit
   * becomes one bucket shared by all visitors.
   */
  readonly trustProxy?: boolean | string | string[];
  /**
   * Serve the generated OpenAPI document and its reference at `/docs`. Off by
   * default so tests do not pay for it.
   */
  readonly docs?: boolean;
  /**
   * Directory holding the built application shell. Its files are served from
   * the root, and any other page request gets `index.html` so that a deep link
   * or a refresh lands in the client router rather than on a 404.
   */
  readonly appDir?: string;
}

/** Every JSON route lives under this, and nothing under it is reachable without an actor. */
export const API_PREFIX = "/api/v1";

const DEFAULT_MAX_GUESTS = 500;

type MapParams = { Params: { mapId: string } };

export function buildServer(deps: ServerDeps): FastifyInstance {
  const limits = deps.limits ?? DEFAULT_LIMITS;
  const tiers = deps.rateLimit ?? {};
  const artifactBase = (deps.publicArtifactBase ?? "/public").replace(/\/$/, "");

  const app = Fastify({
    logger: deps.logger ?? false,
    // A map of 100k features would otherwise be accepted and then die on
    // serialisation; reject it at the edge instead.
    bodyLimit: deps.bodyLimit ?? 2 * 1024 * 1024,
    // Fastify generates one if absent; honouring an inbound header keeps a
    // request traceable across a proxy.
    requestIdHeader: "x-request-id",
    ...(deps.trustProxy === undefined ? {} : { trustProxy: deps.trustProxy }),
    ajv: {
      customOptions: {
        // Fastify's defaults are `true` and `"array"`. The first silently
        // drops properties a schema does not name, so a client that sent a
        // typo would have it accepted and discarded; the second turns the
        // string "5" into a revision number. A body is right or it is refused.
        removeAdditional: false,
        coerceTypes: false,
        // Lets the feature schema name its branch by `kind`, so a bad arrow
        // is reported as a bad arrow and not as six mismatches.
        discriminator: true,
      },
    },
  });

  if (Object.keys(tiers).length > 0) {
    // global: false so only the routes that opt in are limited.
    app.register(rateLimit, {
      global: false,
      // Per actor rather than per IP: a newsroom behind one NAT must not
      // rate-limit itself, and an authenticated caller is the real subject.
      // The limiter is a route hook, so it runs after the auth hook and the
      // actor is there; signup has none and falls back to the address.
      keyGenerator: (req) => {
        const actor = (req as FastifyRequest & { actor?: Actor }).actor;
        return actor ? `${actor.tenantId}:${actor.userId}` : req.ip;
      },
    });
  }

  if (deps.docs) {
    // Registered before any route is declared: the document is built from an
    // onRoute hook, the same mechanism — and the same trap — as the limiter.
    app.register(swagger, {
      openapi: {
        openapi: "3.1.0",
        info: {
          title: "livemap API",
          version: "1",
          description:
            "Authoring API for live-event maps. Published maps are not read " +
            "through it: readers fetch immutable artifacts from a CDN.",
        },
        tags: [
          { name: "session", description: "Who is calling, and how to become someone." },
          { name: "maps", description: "The workspace: create, list, rename, archive." },
          { name: "editing", description: "Feature writes, guarded by revision." },
          { name: "publishing", description: "Versions, the ledger and rollback." },
          { name: "probes" },
        ],
        components: {
          securitySchemes: {
            bearer: { type: "http", scheme: "bearer" },
          },
        },
      },
    });
    app.register(apiReference, {
      routePrefix: "/docs",
      configuration: {
        // Everything below that defaults to reaching another host is turned
        // off: the fonts, the usage telemetry, the hosted assistant, and the
        // button that opens the document in a hosted client.
        withDefaultFonts: false,
        telemetry: false,
        agent: { disabled: true },
        mcp: { disabled: true },
        hideClientButton: true,
        showDeveloperTools: "never",
        theme: "none",
        customCss: DOCS_CSS,
        forceDarkModeState: "light",
        hideDarkModeToggle: true,
      },
    });
  }

  app.decorateRequest("actor", null);

  // Never return a stack trace or a driver message to a client; log it instead.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      req.log?.error({ err, reqId: req.id }, "request failed");
      return reply.code(500).send({ error: "internal_error", reqId: req.id });
    }
    if (err.validation) {
      // The message names the offending field and nothing else; it is built
      // from the schema, not from anything internal.
      return reply
        .code(400)
        .send({ error: "invalid_request", message: err.message });
    }
    // The limiter has already set retry-after on the reply.
    if (status === 429) return reply.code(429).send({ error: "rate_limited" });
    return reply.code(status).send({ error: err.code ?? "bad_request" });
  });

  if (deps.appDir) {
    app.register(fastifyStatic, {
      root: deps.appDir,
      // "/" is a client route like any other; the fallback below answers it.
      index: false,
      // index.html always goes through the fallback, so it always gets the
      // page headers (no-cache, framing) whichever URL asked for it.
      allowedPath: (pathName) => pathName !== "/index.html",
      // Each response sets its own cache-control below.
      cacheControl: false,
      setHeaders: (res, path) => {
        // The embed page runs in a sandboxed frame, whose origin is opaque:
        // every script, stylesheet, font and the map worker it loads is a
        // cross-origin request. These files are public, so saying so costs nothing.
        res.header("access-control-allow-origin", "*");
        res.header("x-content-type-options", "nosniff");
        // Vite content-hashes everything under assets/, so it can never change
        // under a cached copy. Anything else at the root keeps a stable name.
        res.header(
          "cache-control",
          /[\\/]assets[\\/]/.test(path)
            ? "public, max-age=31536000, immutable"
            : "public, max-age=300",
        );
      },
    });
  }
  const jsonNotFound: RouteHandlerMethod = (_req, reply) =>
    reply.code(404).send({ error: "not_found" });

  // A page request is a GET or HEAD for a path with no file extension (or
  // index.html itself). Anything else that misses — a script that was renamed,
  // a POST to nowhere — is a real 404 and must not be answered with HTML.
  const spaFallback: RouteHandlerMethod = (req, reply) => {
    const path = req.url.split("?")[0] ?? "/";
    const page =
      (req.method === "GET" || req.method === "HEAD") &&
      (path === "/index.html" || !/\.[a-z0-9]+$/i.test(path));
    if (!page) return reply.code(404).send({ error: "not_found" });
    // The embed is the one page meant to live in someone else's frame. Every
    // other page must not be framed at all.
    if (path.startsWith("/embed/")) {
      reply.header("content-security-policy", "frame-ancestors *");
    } else {
      reply
        .header("x-frame-options", "DENY")
        .header("content-security-policy", "frame-ancestors 'none'");
    }
    return (
      reply
        .header("cache-control", "no-cache")
        // Without this the file sender writes its own cache-control over ours.
        .sendFile("index.html", { cacheControl: false })
    );
  };

  app.setNotFoundHandler(
    deps.notFound ?? (deps.appDir ? spaFallback : jsonNotFound),
  );

  const actorOf = (req: FastifyRequest): Actor =>
    (req as FastifyRequest & { actor: Actor }).actor;

  const limitsOf = (actor: Actor) => limitsFor(limits, actor.tenantSlug);

  // Per-route limits do not inherit the plugin's max/timeWindow, so the values
  // are threaded through explicitly. An empty `config.rateLimit` silently does
  // nothing.
  const tier = (name: "signup" | "write" | "read") => {
    const t = tiers[name];
    return t
      ? { config: { rateLimit: { max: t.max, timeWindow: t.timeWindow } } }
      : {};
  };

  const publishTier = (() => {
    const t = tiers.publish;
    if (!t) return {};
    const guestMax = t.guestMax ?? t.max;
    return {
      config: {
        rateLimit: {
          max: (req: FastifyRequest) =>
            isGuestSlug(actorOf(req).tenantSlug) ? guestMax : t.max,
          timeWindow: t.timeWindow,
        },
      },
    };
  })();

  const quota = (reply: FastifyReply, reason: string) =>
    reply.code(403).send({ error: "quota_exceeded", reason });

  // The probes and the dev artifact route. In a child scope like everything
  // else, so that they are declared after the plugins above have loaded and
  // appear in the generated document.
  app.register(async (root) => {
  // The static handler answers a bare "/" itself — 403, a directory with no
  // index — before the not-found fallback is ever consulted. So the front
  // door is a route of its own.
  if (deps.appDir) root.get("/", { schema: { hide: true } }, spaFallback);

  root.get(
    "/health",
    { schema: { tags: ["probes"], summary: "Liveness", response: { 200: OK } } },
    async () => ({ ok: true }),
  );

  // What a page needs before it has a session: where artifacts are served
  // from, and whether — and how — a visitor can become a guest. Nothing here
  // is secret; the site key is the public half by design.
  root.get(
    "/config",
    { schema: { tags: ["session"], summary: "Public client configuration" } },
    async (_req, reply) =>
      reply.header("access-control-allow-origin", "*").send({
        artifactBase,
        guestSignup: Boolean(deps.guests),
        humanCheckSiteKey: deps.guests?.humanCheckSiteKey ?? null,
      }),
  );

  // Liveness says the process is up; readiness says it can serve. A failing
  // database must take the instance out of the load balancer, not 500 at users.
  root.get(
    "/ready",
    {
      schema: {
        tags: ["probes"],
        summary: "Readiness: can this instance reach its database",
        response: { 200: OK, 503: OK },
      },
    },
    async (_req, reply) => {
      if (!deps.readiness) return { ok: true };
      const ok = await deps.readiness();
      return reply.code(ok ? 200 : 503).send({ ok });
    },
  );

  // In production the CDN serves these and this route is not registered. It
  // exists so local dev exercises the same cache semantics, conditional
  // requests included. Outside the API scope: artifacts are public by design.
  if (deps.servePublic) {
    root.get<{ Params: { "*": string } }>(
      "/public/*",
      { schema: { hide: true } },
      async (req, reply) => {
      // On every answer, not only the 200: a browser hides a 304 or a 404
      // from the page just as readily when the header is missing.
      reply.header("access-control-allow-origin", "*");
      reply.header("access-control-expose-headers", "etag");

      const key = req.params["*"];
      const obj = await deps.store.get(key);
      if (!obj) return reply.code(404).send({ error: "not_found" });

      const inm = req.headers["if-none-match"];
      if (inm && inm === obj.etag) {
        // A 304 must carry no body and must repeat the validators.
        return reply
          .code(304)
          .header("etag", obj.etag)
          .header("cache-control", obj.cacheControl)
          .send();
      }

      return reply
        .code(200)
        .header("content-type", obj.contentType)
        .header("cache-control", obj.cacheControl)
        .header("etag", obj.etag)
        .send(obj.body);
      },
    );

    // The viewer polls with `cache-control` and `if-none-match`, neither of
    // which a browser sends cross-origin without asking first. The bucket's
    // CORS rule answers this in production; this is its local stand-in.
    root.options(
      "/public/*",
      { schema: { hide: true } },
      async (_req, reply) =>
        reply
          .code(204)
          .header("access-control-allow-origin", "*")
          .header("access-control-allow-methods", "GET, HEAD")
          .header("access-control-allow-headers", "cache-control, if-none-match")
          .header("access-control-max-age", "600")
          .send(),
    );
  }
  });

  // Guest signup: the only route that writes without an actor, and so the one
  // with the most in front of it. In order — a per-address rate limit, a human
  // check, a ceiling on how many guests may exist at all — and only then a
  // tenant. A child scope for the same reason as the API below: the limiter
  // has to have run before the route is declared.
  const guests = deps.guests;
  if (guests) {
    app.register(async (scope) => {
      scope.post<{ Body?: { turnstileToken?: string } }>(
        "/auth/guest",
        {
          schema: {
            tags: ["session"],
            summary: "Start a temporary guest workspace",
            description:
              "Creates a workspace that expires after seven days and returns a " +
              "bearer token for it. Send an empty JSON object when no human " +
              "check is configured.",
            body: GUEST_BODY,
            response: { 201: GUEST_CREATED, 403: ERROR, 429: ERROR, 503: ERROR },
          },
          ...tier("signup"),
        },
        async (req, reply) => {
          if (
            guests.humanCheck &&
            !(await guests.humanCheck(req.body?.turnstileToken, req.ip))
          ) {
            return reply.code(403).send({ error: "human_check_failed" });
          }

          const cap = guests.maxGuests ?? DEFAULT_MAX_GUESTS;
          if ((await guests.provisioner.count()) >= cap) {
            // 503, not 429: the caller did nothing wrong and waiting a minute
            // will not help. Capacity returns when expired guests are reaped.
            return reply
              .code(503)
              .header("retry-after", 3600)
              .send({ error: "guest_capacity" });
          }

          const identity = await guests.provisioner.provision();
          const exp =
            Math.floor(Date.now() / 1000) + (guests.ttlSecs ?? GUEST_TTL_SECS);
          return reply.code(201).send({
            token: guests.issueToken({ ...identity, exp }),
            tenantSlug: identity.tenantSlug,
            expiresAt: new Date(exp * 1000).toISOString(),
          });
        },
      );
    });
  }

  // The API is a child scope for two reasons. It is registered after the rate
  // limiter, whose onRoute hook only sees routes declared once it has actually
  // run — on the root instance `config.rateLimit` is inert. And the auth hook
  // belongs to the scope rather than to the server: everything under the prefix
  // is denied by default, unknown paths included, and nothing outside it needs
  // an allowlist entry to be reachable.
  app.register(async (scope) => {
    // Counts rejected credentials per address. Not a route limit, because it
    // must count only the failures: a newsroom's valid traffic shares an
    // address and must never be throttled by it.
    const failedAuth = tiers.unauth
      ? scope.createRateLimit({
          max: tiers.unauth.max,
          timeWindow: tiers.unauth.timeWindow,
          keyGenerator: (req) => `unauth:${req.ip}`,
        })
      : null;

    // The one place tenant scoping is established; handlers below assume
    // `req.actor` is present and already scoped.
    scope.addHook("onRequest", async (req, reply) => {
      const claimed = await deps.auth.resolve(req);

      // The token says who; the database says what they may do, and whether
      // they are still anyone at all. A role claim outlives a demotion, and a
      // guest's token outlives the workspace it was issued for.
      const role = claimed ? await deps.repo.membershipRole(claimed) : null;

      if (!claimed || role === null) {
        if (failedAuth) {
          const hit = await failedAuth(req);
          if (!hit.isAllowed && hit.isExceeded) {
            return reply
              .code(429)
              .header("retry-after", hit.ttlInSeconds)
              .send({ error: "rate_limited" });
          }
        }
        return reply.code(401).send({ error: "unauthorised" });
      }

      const actor: Actor = { ...claimed, role };
      (req as FastifyRequest & { actor: Actor }).actor = actor;

      // The server-wide body limit is the ceiling; a tenant's own may be
      // lower. Checked on the declared length, before anything is read.
      const declared = Number(req.headers["content-length"] ?? 0);
      if (declared > limitsOf(actor).maxBodyBytes) {
        return reply.code(413).send({ error: "body_too_large" });
      }
      return;
    });

    // An API miss is always JSON, whatever the caller's fallback serves for
    // pages. Scoped, so the hook above runs first and an anonymous probe of the
    // prefix learns nothing about which routes exist.
    scope.setNotFoundHandler((_req, reply) =>
      reply.code(404).send({ error: "not_found" }),
    );

    // What the shell needs to draw itself, so it never has to decode a token.
    const secured = [{ bearer: [] }];

    scope.get(
      "/me",
      {
        schema: {
          tags: ["session"],
          summary: "The caller: role, capabilities, usage and limits",
          security: secured,
        },
        ...tier("read"),
      },
      async (req) => {
      const actor = actorOf(req);
      return {
        userId: actor.userId,
        tenant: { id: actor.tenantId, slug: actor.tenantSlug },
        role: actor.role,
        capabilities: capabilitiesOf(actor.role),
        guest: isGuestSlug(actor.tenantSlug),
        expiresAt:
          actor.expiresAt === undefined
            ? null
            : new Date(actor.expiresAt * 1000).toISOString(),
        usage: { maps: await deps.repo.countMaps(actor) },
        limits: limitsOf(actor),
        artifactBase,
      };
      },
    );

    scope.get(
      "/templates",
      {
        schema: {
          tags: ["maps"],
          summary: "Starting points offered when creating a map",
          security: secured,
        },
        ...tier("read"),
      },
      async () => ({
        templates: TEMPLATES.map((t) => ({
          id: t.id,
          title: t.title,
          uiDir: t.uiDir,
          featureCount: t.features.length,
        })),
      }),
    );

    scope.get<{ Querystring: { archived?: "0" | "1" } }>(
      "/maps",
      {
        schema: {
          tags: ["maps"],
          summary: "List the workspace's maps",
          security: secured,
          querystring: LIST_QUERY,
        },
        ...tier("read"),
      },
      async (req) => ({
        maps: await deps.repo.listMaps(actorOf(req), {
          archived: req.query.archived === "1",
        }),
      }),
    );

    scope.post<{
      Body: { title: RichText; uiDir?: TextDir; template?: string };
    }>(
      "/maps",
      {
        schema: {
          tags: ["maps"],
          summary: "Create a map, empty or from a template",
          security: secured,
          body: CREATE_BODY,
        },
        ...tier("write"),
      },
      async (req, reply) => {
        const actor = actorOf(req);
        if (!can(actor.role, "map:create")) {
          return reply.code(403).send({ error: "forbidden" });
        }

        const template = req.body.template
          ? findTemplate(req.body.template)
          : null;
        if (req.body.template && !template) {
          return reply.code(400).send({ error: "unknown_template" });
        }

        const draft: MapDraft = {
          title: req.body.title,
          uiDir: req.body.uiDir ?? template?.uiDir ?? "ltr",
          viewport: template?.viewport ?? BLANK_VIEWPORT,
          basemap: {
            styleId: "light",
            labelLangs: template?.labelLangs ?? ["en"],
          },
          features: template?.features ?? [],
        };

        const out = await deps.repo.createMap(actor, draft, {
          maxMaps: limitsOf(actor).maxMaps,
        });
        if (out.status === "quota") return quota(reply, out.reason);
        return reply.code(201).send({ map: out.doc });
      },
    );

    scope.get<MapParams>(
      "/maps/:mapId",
      {
        schema: {
          tags: ["maps"],
          summary: "A map and all of its features",
          security: secured,
          params: MAP_PARAMS,
        },
        ...tier("read"),
      },
      async (req, reply) => {
        const actor = actorOf(req);
        const doc = await deps.repo.getMap(actor, req.params.mapId);
        if (!doc) return reply.code(404).send({ error: "not_found" });
        const features = await deps.repo.listFeatures(actor, req.params.mapId);
        return { map: doc, features };
      },
    );

    scope.patch<MapParams & { Body: { title?: RichText; uiDir?: TextDir } }>(
      "/maps/:mapId",
      {
        schema: {
          tags: ["maps"],
          summary: "Retitle a map or change its direction",
          description:
            "The slug cannot be changed: published artifact URLs are built " +
            "from it.",
          security: secured,
          params: MAP_PARAMS,
          body: PATCH_BODY,
        },
        ...tier("write"),
      },
      async (req, reply) => {
        const actor = actorOf(req);
        if (!can(actor.role, "map:edit")) {
          return reply.code(403).send({ error: "forbidden" });
        }

        const patch: MapPatch = {
          ...(req.body.title ? { title: req.body.title } : {}),
          ...(req.body.uiDir ? { uiDir: req.body.uiDir } : {}),
        };
        const out = await deps.repo.updateMap(actor, req.params.mapId, patch);

        switch (out.status) {
          case "updated":
            return { map: out.doc };
          case "not_found":
            return reply.code(404).send({ error: "not_found" });
          case "forbidden":
            return reply.code(403).send({ error: "forbidden", reason: out.reason });
        }
      },
    );

    for (const [path, archived] of [
      ["archive", true],
      ["unarchive", false],
    ] as const) {
      scope.post<MapParams>(
        `/maps/:mapId/${path}`,
        {
          schema: {
            tags: ["maps"],
            summary: archived
              ? "Archive a map. Does not unpublish it"
              : "Restore an archived map",
            security: secured,
            params: MAP_PARAMS,
          },
          ...tier("write"),
        },
        async (req, reply) => {
          const actor = actorOf(req);
          if (!can(actor.role, "map:edit")) {
            return reply.code(403).send({ error: "forbidden" });
          }
          const out = await deps.repo.setArchived(
            actor,
            req.params.mapId,
            archived,
          );
          switch (out.status) {
            case "ok":
              return { archived };
            case "not_found":
              return reply.code(404).send({ error: "not_found" });
            case "forbidden":
              return reply
                .code(403)
                .send({ error: "forbidden", reason: out.reason });
          }
        },
      );
    }

    scope.get<MapParams>(
      "/maps/:mapId/versions",
      {
        schema: {
          tags: ["publishing"],
          summary: "The version ledger, newest first",
          security: secured,
          params: MAP_PARAMS,
        },
        ...tier("read"),
      },
      async (req, reply) => {
        const actor = actorOf(req);
        const doc = await deps.repo.getMap(actor, req.params.mapId);
        if (!doc) return reply.code(404).send({ error: "not_found" });
        return {
          publishedVersion: doc.publishedVersion ?? null,
          versions: await deps.repo.listVersions(actor, req.params.mapId),
        };
      },
    );

    scope.post<
      MapParams & {
        Body: { rev?: number; put?: MapFeature[]; delete?: string[] };
      }
    >(
      "/maps/:mapId/edit",
      {
        schema: {
          tags: ["editing"],
          summary: "Put and delete features against a known revision",
          description:
            "`rev` is the revision the client last read. A stale one is " +
            "refused with 409 rather than overwriting an edit it never saw.",
          security: secured,
          params: MAP_PARAMS,
          body: EDIT_BODY,
          response: { 200: EDIT_APPLIED, 400: ERROR, 403: ERROR, 404: ERROR, 409: ERROR },
        },
        ...tier("write"),
      },
      async (req, reply) => {
      const actor = actorOf(req);

      // The cheap half of the decision, before the body is even looked at. The
      // other half needs the map row — whether a contributor owns it — and so
      // happens inside `applyEdit`, against the row it already holds.
      if (!can(actor.role, "map:edit")) {
        return reply.code(403).send({ error: "forbidden" });
      }

      const body = req.body;
      if (typeof body.rev !== "number") {
        // Mandatory, not optional: without it a stale client could clobber an
        // edit it never saw.
        return reply.code(400).send({ error: "rev_required" });
      }

      const out = await deps.repo.applyEdit(
        actor,
        req.params.mapId,
        body.rev,
        body.put ?? [],
        body.delete ?? [],
        { maxFeaturesPerMap: limitsOf(actor).maxFeaturesPerMap },
      );

      switch (out.status) {
        case "applied":
          return { rev: out.rev };
        case "stale":
          // 409, not 500: the client should re-read and retry.
          return reply.code(409).send({ error: "stale_revision" });
        case "not_found":
          return reply.code(404).send({ error: "not_found" });
        case "forbidden":
          // Distinct from 409 on purpose: retrying will never help.
          return reply.code(403).send({ error: "forbidden", reason: out.reason });
        case "quota":
          return quota(reply, out.reason);
      }
      },
    );

    // Shared by publish and rollback, which differ only in what a success is
    // called.
    const sendPublish = (
      reply: FastifyReply,
      out: Exclude<PublishOutcome, { status: "published" }>,
    ) => {
      switch (out.status) {
        case "unchanged":
          // 200, not 201: nothing was created.
          return reply.code(200).send({
            status: "unchanged",
            version: out.version,
            etag: out.etag,
          });
        case "forbidden":
          return reply.code(403).send({ error: "forbidden", reason: out.reason });
        case "not_found":
          return reply.code(404).send({ error: "not_found" });
        case "quota":
          return quota(reply, out.reason);
      }
    };

    scope.post<MapParams>(
      "/maps/:mapId/publish",
      {
        schema: {
          tags: ["publishing"],
          summary: "Publish the map as a new immutable version",
          description:
            "Answers 200 `unchanged` when the content is identical to the " +
            "newest version, so reader caches stay warm.",
          security: secured,
          params: MAP_PARAMS,
        },
        ...publishTier,
      },
      async (req, reply) => {
        const actor = actorOf(req);
        const out = await publishMap(deps.repo, deps.store, {
          ctx: actor,
          tenantSlug: actor.tenantSlug,
          mapId: req.params.mapId,
          maxVersions: limitsOf(actor).maxVersionsPerMap,
        });

        if (out.status !== "published") return sendPublish(reply, out);
        return reply.code(201).send({
          status: "published",
          version: out.version.version,
          etag: out.version.etag,
        });
      },
    );

    scope.post<MapParams & { Body: { toVersion?: number } }>(
      "/maps/:mapId/rollback",
      {
        schema: {
          tags: ["publishing"],
          summary: "Republish an earlier version as the newest",
          description: "The ledger is append-only: a rollback is a new version.",
          security: secured,
          params: MAP_PARAMS,
          body: ROLLBACK_BODY,
        },
        ...publishTier,
      },
      async (req, reply) => {
        const actor = actorOf(req);
        const toVersion = req.body.toVersion;
        if (typeof toVersion !== "number" || toVersion < 1) {
          return reply.code(400).send({ error: "to_version_required" });
        }

        const out = await rollbackMap(deps.repo, deps.store, {
          ctx: actor,
          tenantSlug: actor.tenantSlug,
          mapId: req.params.mapId,
          toVersion,
          maxVersions: limitsOf(actor).maxVersionsPerMap,
        });

        if (out.status !== "published") return sendPublish(reply, out);
        return reply
          .code(201)
          .send({ status: "rolled_back", version: out.version.version });
      },
    );
  }, { prefix: API_PREFIX });

  return app;
}

/** Fixed-actor resolver for local development and tests. Never for production. */
export class StaticAuth implements AuthResolver {
  constructor(private readonly actor: Actor | null) {}
  async resolve(): Promise<Actor | null> {
    return this.actor;
  }
}
