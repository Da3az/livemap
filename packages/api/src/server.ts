import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest,
  type FastifyServerOptions,
  type RouteHandlerMethod,
} from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { MapFeature } from "@livemap/core";
import type { MapRepo } from "./repo.js";
import type { ArtifactStore } from "./storage.js";
import { publishMap, rollbackMap } from "./publish.js";

export interface Actor {
  readonly userId: string;
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly role: string;
}

export interface AuthResolver {
  /** Return null to reject with 401. */
  resolve(req: FastifyRequest): Promise<Actor | null>;
}

export interface RateLimitConfig {
  readonly max: number;
  readonly timeWindow: string | number;
}

export interface ServerDeps {
  readonly repo: MapRepo;
  readonly store: ArtifactStore;
  readonly auth: AuthResolver;
  readonly logger?: FastifyServerOptions["logger"];
  /** Applied to mutating routes only; reads are served from the CDN. */
  readonly rateLimit?: RateLimitConfig;
  /** Largest accepted edit body. Defaults to 2 MB. */
  readonly bodyLimit?: number;
  /** Checked by GET /ready. Omit and readiness is just liveness. */
  readonly readiness?: () => Promise<boolean>;
  /**
   * Replaces the default JSON 404. Fastify allows only one per prefix, so a
   * caller that wants to serve static pages from the fallback has to supply it
   * here rather than calling `setNotFoundHandler` on the returned instance.
   */
  readonly notFound?: RouteHandlerMethod;
}

/** Roles allowed to mutate features. `viewer` is read-only. */
const EDITING_ROLES = new Set(["owner", "admin", "editor", "contributor"]);

/** Reachable without a token: probes must work before auth is configured. */
const PUBLIC_PATHS = new Set(["/health", "/ready"]);

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.logger ?? false,
    // A map of 100k features would otherwise be accepted and then die on
    // serialisation; reject it at the edge instead.
    bodyLimit: deps.bodyLimit ?? 2 * 1024 * 1024,
    // Fastify generates one if absent; honouring an inbound header keeps a
    // request traceable across a proxy.
    requestIdHeader: "x-request-id",
  });

  if (deps.rateLimit) {
    // global: false so only the routes that opt in are limited.
    app.register(rateLimit, {
      global: false,
      max: deps.rateLimit.max,
      timeWindow: deps.rateLimit.timeWindow,
      // Per actor rather than per IP: a newsroom behind one NAT must not
      // rate-limit itself, and an authenticated caller is the real subject.
      // Falls back to IP when the limiter runs before the auth hook.
      keyGenerator: (req) => {
        const actor = (req as FastifyRequest & { actor?: Actor }).actor;
        return actor ? `${actor.tenantId}:${actor.userId}` : req.ip;
      },
    });
  }

  // The one place tenant scoping is established; handlers below assume
  // `req.actor` is present and already scoped.
  app.decorateRequest("actor", null);

  app.addHook("onRequest", async (req, reply) => {
    if (PUBLIC_PATHS.has(req.url)) return;
    const actor = await deps.auth.resolve(req);
    if (!actor) {
      await reply.code(401).send({ error: "unauthorised" });
      return;
    }
    (req as FastifyRequest & { actor: Actor }).actor = actor;
  });

  // Never return a stack trace or a driver message to a client; log it instead.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      req.log?.error({ err, reqId: req.id }, "request failed");
      return reply.code(500).send({ error: "internal_error", reqId: req.id });
    }
    return reply.code(status).send({ error: err.code ?? "bad_request" });
  });

  app.setNotFoundHandler(
    deps.notFound ?? ((_req, reply) => reply.code(404).send({ error: "not_found" })),
  );

  const actorOf = (req: FastifyRequest): Actor =>
    (req as FastifyRequest & { actor: Actor }).actor;

  // Per-route limits do not inherit the plugin's max/timeWindow, so the values
  // are threaded through explicitly. An empty `config.rateLimit` silently does
  // nothing.
  const writeLimit = deps.rateLimit
    ? {
        config: {
          rateLimit: {
            max: deps.rateLimit.max,
            timeWindow: deps.rateLimit.timeWindow,
          },
        },
      }
    : {};

  app.get("/health", async () => ({ ok: true }));

  // Liveness says the process is up; readiness says it can serve. A failing
  // database must take the instance out of the load balancer, not 500 at users.
  app.get("/ready", async (_req, reply) => {
    if (!deps.readiness) return { ok: true };
    const ok = await deps.readiness();
    return reply.code(ok ? 200 : 503).send({ ok });
  });

  // Routes live in a child scope registered after the rate limiter, because the
  // limiter's onRoute hook only sees routes declared once it has actually run.
  // Declaring them on the root instance leaves `config.rateLimit` inert.
  app.register(async (scope) => {
    scope.get<{ Params: { mapId: string } }>(
      "/maps/:mapId",
      async (req, reply) => {
        const actor = actorOf(req);
        const doc = await deps.repo.getMap(actor.tenantId, req.params.mapId);
        if (!doc) return reply.code(404).send({ error: "not_found" });
        const features = await deps.repo.listFeatures(
          actor.tenantId,
          req.params.mapId,
        );
        return { map: doc, features };
      },
    );

    scope.post<{
      Params: { mapId: string };
      Body: { rev?: number; put?: MapFeature[]; delete?: string[] };
    }>("/maps/:mapId/edit", writeLimit, async (req, reply) => {
      const actor = actorOf(req);
      if (!EDITING_ROLES.has(actor.role)) {
        return reply.code(403).send({ error: "forbidden" });
      }

      const body = req.body ?? {};
      if (typeof body.rev !== "number") {
        // Mandatory, not optional: without it a stale client could clobber an
        // edit it never saw.
        return reply.code(400).send({ error: "rev_required" });
      }

      const nextRev = await deps.repo.applyEdit(
        actor.tenantId,
        req.params.mapId,
        body.rev,
        body.put ?? [],
        body.delete ?? [],
      );

      if (nextRev === null) {
        // 409, not 500: the client should re-read and retry.
        return reply.code(409).send({ error: "stale_revision" });
      }
      return { rev: nextRev };
    });

    scope.post<{ Params: { mapId: string } }>(
      "/maps/:mapId/publish",
      writeLimit,
      async (req, reply) => {
        const actor = actorOf(req);
        const out = await publishMap(deps.repo, deps.store, {
          tenantId: actor.tenantId,
          tenantSlug: actor.tenantSlug,
          mapId: req.params.mapId,
          actorId: actor.userId,
          actorRole: actor.role,
        });

        switch (out.status) {
          case "published":
            return reply.code(201).send({
              status: "published",
              version: out.version.version,
              etag: out.version.etag,
            });
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
        }
      },
    );

    scope.post<{ Params: { mapId: string }; Body: { toVersion?: number } }>(
      "/maps/:mapId/rollback",
      writeLimit,
      async (req, reply) => {
        const actor = actorOf(req);
        const toVersion = req.body?.toVersion;
        if (typeof toVersion !== "number" || toVersion < 1) {
          return reply.code(400).send({ error: "to_version_required" });
        }

        const out = await rollbackMap(deps.repo, deps.store, {
          tenantId: actor.tenantId,
          tenantSlug: actor.tenantSlug,
          mapId: req.params.mapId,
          actorId: actor.userId,
          actorRole: actor.role,
          toVersion,
        });

        switch (out.status) {
          case "published":
            return reply
              .code(201)
              .send({ status: "rolled_back", version: out.version.version });
          case "forbidden":
            return reply.code(403).send({ error: "forbidden", reason: out.reason });
          case "not_found":
            return reply.code(404).send({ error: "not_found" });
          case "unchanged":
            return reply.code(200).send({ status: "unchanged" });
        }
      },
    );

    // In production the CDN serves these and this route never runs. It exists so
    // local dev exercises the same cache semantics, conditional requests included.
    scope.get<{ Params: { "*": string } }>("/public/*", async (req, reply) => {
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
        // Published artifacts are public by design and embedded cross-origin.
        .header("access-control-allow-origin", "*")
        .send(obj.body);
    });

  });

  return app;
}

/** Fixed-actor resolver for local development and tests. Never for production. */
export class StaticAuth implements AuthResolver {
  constructor(private readonly actor: Actor | null) {}
  async resolve(): Promise<Actor | null> {
    return this.actor;
  }
}
