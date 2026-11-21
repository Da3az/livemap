import type { MapDoc } from "@livemap/core";
import { EditorApp } from "@livemap/editor";
import { el, link } from "../dom.js";
import { errorText, type Ctx, type Page } from "../ctx.js";
import { embedUrl, icons, resolveStyle } from "../map-kit.js";

export function editorPage(ctx: Ctx, mapId: string): Page {
  const canEdit = ctx.session.capabilities.includes("map:edit");

  // What the page knows about the map. The editor reports the document once
  // loaded; the title is then owned here, because renaming goes through the
  // API directly and the editor's copy would be stale.
  let doc: MapDoc | null = null;
  let title = "";

  const titleInput = el("input", {
    type: "text",
    class: "title-input",
    maxlength: 200,
    "aria-label": "Map title",
    disabled: !canEdit,
  });
  const versions = link(`/maps/${mapId}/versions`, "Versions", "pagehead-link");

  const mapContainer = el("div", { class: "map" });
  const root = el("div", { class: "editor", dir: "ltr" }, [
    el("div", { class: "toolbar" }),
    mapContainer,
    el("aside", { class: "panels" }, [
      el("section", { class: "panel", hidden: true }, [
        el("h2", { class: "panel-title" }, ["Inspector"]),
        el("div", { class: "inspector-body" }),
      ]),
      el("section", { class: "panel", hidden: true }, [
        el("h2", { class: "panel-title" }, ["Features"]),
        el("div", { class: "feature-list" }),
      ]),
    ]),
    el("div", { class: "status" }, ["loading…"]),
  ]);

  const node = el("div", { class: "page is-editor" }, [
    el("header", { class: "pagehead is-tight" }, [
      el("nav", { class: "crumbs", "aria-label": "Breadcrumb" }, [
        link("/maps", "Maps"),
        el("span", { class: "crumb-sep" }, ["/"]),
        titleInput,
      ]),
      el("span", { class: "spacer" }),
      versions,
    ]),
    root,
  ]);

  const rename = async () => {
    const value = titleInput.value.trim();
    if (!doc || !value || value === title) {
      titleInput.value = title;
      return;
    }
    try {
      const updated = await ctx.api.renameMap(mapId, {
        value,
        dir: doc.title.dir,
      });
      title = updated.title.value;
      titleInput.value = title;
      document.title = `${title} — livemap`;
    } catch (err) {
      titleInput.value = title;
      ctx.notify(errorText(err), "error");
    }
  };
  titleInput.addEventListener("change", () => void rename());
  titleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") titleInput.blur();
    if (e.key === "Escape") {
      titleInput.value = title;
      titleInput.blur();
    }
  });

  let app: EditorApp | null = null;

  const warnUnsaved = (e: BeforeUnloadEvent) => {
    if (app?.hasUnsavedChanges) e.preventDefault();
  };

  return {
    node,

    mounted() {
      // Constructed here, not above: MapLibre measures its container when it
      // is created, and before this the container is not in the document.
      app = new EditorApp({
        root,
        mapContainer,
        apiBase: "",
        mapId,
        style: resolveStyle(),
        icons,
        // The shell's fetch carries the session token. Without it every
        // request the editor made would be refused.
        fetchImpl: ctx.api.fetch,
        onPreview: () => {
          if (!doc?.publishedVersion) {
            ctx.notify("Preview shows what readers see. Publish the map first.");
            return;
          }
          window.open(
            embedUrl(ctx.session.tenant.slug, doc.slug),
            "_blank",
            "noopener",
          );
        },
        onDocument: (d) => {
          if (!doc) {
            title = d.title.value;
            titleInput.value = title;
            titleInput.dir = d.title.dir;
            document.title = `${title} — livemap`;
          }
          doc = d;
          versions.textContent = d.publishedVersion
            ? `Versions · v${d.publishedVersion}`
            : "Versions";
        },
      });
      app.start().catch((err) => ctx.notify(errorText(err), "error"));
      window.addEventListener("beforeunload", warnUnsaved);
    },

    canLeave: () =>
      !app?.hasUnsavedChanges ||
      window.confirm("This map has unsaved changes. Leave without saving?"),

    destroy() {
      window.removeEventListener("beforeunload", warnUnsaved);
      app?.destroy();
      document.title = "livemap";
    },
  };
}
