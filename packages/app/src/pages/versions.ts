import type { MapDoc } from "@livemap/core";
import { startEmbedParent } from "@livemap/viewer";
import type { VersionRecord } from "../api.js";
import { button, el, formatBytes, formatDateTime, link, mono } from "../dom.js";
import { errorText, type Ctx, type Page } from "../ctx.js";
import { artifactUrls, embedUrl } from "../map-kit.js";

const COLUMNS = [
  "Version",
  "ETag",
  "Size",
  "Features",
  "Published",
  "By",
  "Cache-Control",
  "",
];

/** How many rows have their headers fetched. They are identical by construction below that. */
const HEADERS_CHECKED = 8;
const PREVIEW_ID = "preview";

/**
 * Asks the artifact itself how it is cached. The point of this page is to show
 * the policy that is in force, so it is read off the response and not printed
 * from a constant that could say anything.
 */
async function cacheControlOf(url: string): Promise<string> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) return `missing (${res.status})`;
    return res.headers.get("cache-control") ?? "none sent";
  } catch {
    return "unreachable";
  }
}

export function versionsPage(ctx: Ctx, mapId: string): Page {
  const canPublish = ctx.session.capabilities.includes("map:publish");
  const tenant = ctx.session.tenant.slug;

  const crumbTitle = link(`/maps/${mapId}`, "…");
  const pointer = el("div", { class: "pointer" });
  const tbody = el("tbody");
  const embed = el("section", { class: "embed" });
  let stopEmbed: (() => void) | null = null;

  const node = el("div", { class: "page" }, [
    el("header", { class: "pagehead" }, [
      el("nav", { class: "crumbs", "aria-label": "Breadcrumb" }, [
        link("/maps", "Maps"),
        el("span", { class: "crumb-sep" }, ["/"]),
        crumbTitle,
        el("span", { class: "crumb-sep" }, ["/"]),
        el("h1", {}, ["Versions"]),
      ]),
    ]),
    pointer,
    el("table", { class: "grid" }, [
      el("thead", {}, [
        el("tr", {}, COLUMNS.map((c) => el("th", { scope: "col" }, [c]))),
      ]),
      tbody,
    ]),
    embed,
  ]);

  const headerCell = (url: string): HTMLElement => {
    const cell = mono("…", { class: "dim" });
    void cacheControlOf(url).then((v) => {
      cell.textContent = v;
      cell.classList.remove("dim");
    });
    return cell;
  };

  const renderPointer = (doc: MapDoc, urls: ReturnType<typeof artifactUrls>) => {
    pointer.replaceChildren(
      el("span", { class: "pointer-label" }, ["Pointer"]),
      el("a", { href: urls.pointer, target: "_blank", rel: "noopener", class: "mono" }, [
        "latest.json",
      ]),
      mono(doc.publishedVersion ? `→ v${doc.publishedVersion}` : "→ nothing published"),
      doc.publishedVersion ? headerCell(urls.pointer) : "",
    );
  };

  const renderEmbed = (doc: MapDoc) => {
    stopEmbed?.();
    stopEmbed = null;
    embed.replaceChildren();
    // Nothing published, nothing to embed: the section is absent, not empty.
    if (!doc.publishedVersion) return;

    const id = `livemap-${doc.slug}`;
    const src = `${location.origin}${embedUrl(tenant, doc.slug, id)}`;
    const snippet = [
      `<iframe id="${id}" src="${src}"`,
      `        title="${doc.title.value.replace(/"/g, "&quot;")}" loading="lazy"`,
      `        sandbox="allow-scripts allow-popups"`,
      `        style="width:100%;height:460px;border:0"></iframe>`,
      `<script type="module">`,
      `  import { startEmbedParent } from "${location.origin}/embed-host.js";`,
      `  startEmbedParent({ id: "${id}", iframe: document.getElementById("${id}") });`,
      `</script>`,
    ].join("\n");

    const code = el("textarea", {
      class: "snippet mono",
      readonly: true,
      rows: 8,
      spellcheck: "false",
      "aria-label": "Embed code",
    });
    code.value = snippet;

    const copy = button("Copy", () => {
      void navigator.clipboard
        .writeText(snippet)
        .then(() => ctx.notify("Embed code copied."))
        .catch(() => {
          code.select();
          ctx.notify("Select the code and copy it.", "error");
        });
    });

    const frame = el("iframe", {
      class: "embed-frame",
      src: embedUrl(tenant, doc.slug, PREVIEW_ID),
      title: doc.title.value,
      loading: "lazy",
      // The same sandbox a publisher's page gives it, so the preview cannot
      // work here and fail there.
      sandbox: "allow-scripts allow-popups",
    });
    stopEmbed = startEmbedParent({ id: PREVIEW_ID, iframe: frame });

    embed.append(
      el("div", { class: "embed-head" }, [el("h2", {}, ["Embed"]), copy]),
      el("div", { class: "embed-body" }, [code, frame]),
    );
  };

  async function load(): Promise<void> {
    try {
      const [doc, ledger] = await Promise.all([
        ctx.api.getMap(mapId),
        ctx.api.versions(mapId),
      ]);
      const urls = artifactUrls(ctx.session.artifactBase, tenant, doc.slug);

      crumbTitle.textContent = doc.title.value;
      crumbTitle.dir = doc.title.dir;
      document.title = `Versions · ${doc.title.value} — livemap`;
      renderPointer(doc, urls);
      renderEmbed(doc);

      tbody.replaceChildren(
        ...ledger.versions.map((v: VersionRecord, i: number) => {
          const live = v.version === ledger.publishedVersion;
          const url = urls.version(v.version);
          return el("tr", { class: live ? "is-live" : "" }, [
            el("td", {}, [mono(`v${v.version}`), live && mono("live", { class: "badge" })]),
            el("td", {}, [mono(v.etag.slice(0, 12), { title: v.etag })]),
            el("td", { class: "num" }, [mono(formatBytes(v.byteSize))]),
            el("td", { class: "num" }, [mono(String(v.featureCount))]),
            el("td", {}, [mono(formatDateTime(v.publishedAt))]),
            el("td", {}, [mono(v.publishedBy.slice(0, 8), { title: v.publishedBy })]),
            el("td", {}, [
              i < HEADERS_CHECKED ? headerCell(url) : mono("not checked", { class: "dim" }),
            ]),
            el("td", { class: "cell-actions" }, [
              el("a", { href: url, target: "_blank", rel: "noopener", class: "mono" }, [
                `v/${v.version}.json`,
              ]),
              canPublish &&
                !live &&
                button(
                  "Roll back to this",
                  () => {
                    void (async () => {
                      try {
                        const out = await ctx.api.rollback(mapId, v.version);
                        ctx.notify(
                          `v${v.version} republished as v${out.version}. The ledger is append-only.`,
                        );
                        await load();
                      } catch (err) {
                        ctx.notify(errorText(err), "error");
                      }
                    })();
                  },
                  "btn-text",
                ),
            ]),
          ]);
        }),
      );
    } catch (err) {
      ctx.notify(errorText(err), "error");
    }
  }

  void load();

  return {
    node,
    destroy() {
      stopEmbed?.();
      document.title = "livemap";
    },
  };
}
