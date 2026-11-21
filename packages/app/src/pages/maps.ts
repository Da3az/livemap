import type { MapSummary, TemplateSummary } from "../api.js";
import { button, el, formatDateTime, link, mono } from "../dom.js";
import { errorText, type Ctx, type Page } from "../ctx.js";

const COLUMNS = ["Title", "Dir", "Features", "Rev", "Published", "Updated", ""];

export function mapsPage(ctx: Ctx): Page {
  const canCreate = ctx.session.capabilities.includes("map:create");
  const canEdit = ctx.session.capabilities.includes("map:edit");

  let archived = false;
  let templates: TemplateSummary[] = [];
  let formOpen = false;

  const usage = mono("", { class: "usage", title: "Maps used of the workspace limit" });
  const tbody = el("tbody");
  const formSlot = el("div");
  const tabs = el("div", { class: "tabs", role: "tablist" });

  const table = el("table", { class: "grid" }, [
    el("thead", {}, [
      el("tr", {}, COLUMNS.map((c) => el("th", { scope: "col" }, [c]))),
    ]),
    tbody,
  ]);

  const renderUsage = () => {
    const { usage: u, limits } = ctx.session;
    usage.textContent = `${u.maps} / ${limits.maxMaps}`;
  };

  const renderTabs = () => {
    tabs.replaceChildren(
      ...([
        ["Active", false],
        ["Archived", true],
      ] as const).map(([label, value]) => {
        const b = button(
          label,
          () => {
            archived = value;
            renderTabs();
            void load();
          },
          `tab${archived === value ? " is-on" : ""}`,
        );
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", String(archived === value));
        return b;
      }),
    );
  };

  const row = (m: MapSummary): HTMLElement => {
    const title = link(`/maps/${m.id}`, m.title.value, "cell-title");
    title.dir = m.title.dir;

    const actions = el("td", { class: "cell-actions" }, [
      link(`/maps/${m.id}/versions`, "Versions"),
      canEdit &&
        button(
          m.archived ? "Restore" : "Archive",
          () => {
            void (async () => {
              try {
                await ctx.api.setArchived(m.id, !m.archived);
                ctx.notify(
                  m.archived
                    ? `Restored "${m.title.value}".`
                    : `Archived "${m.title.value}". It stays published.`,
                );
                await load();
              } catch (err) {
                ctx.notify(errorText(err), "error");
              }
            })();
          },
          "btn-text",
        ),
    ]);

    return el("tr", {}, [
      // An archived map cannot be opened in the editor, so it is not a link.
      el("td", {}, [
        m.archived
          ? el("span", { class: "cell-title", dir: m.title.dir }, [m.title.value])
          : title,
      ]),
      el("td", {}, [mono(m.uiDir, { class: "badge" })]),
      el("td", { class: "num" }, [mono(String(m.featureCount))]),
      el("td", { class: "num" }, [mono(String(m.rev))]),
      el("td", {}, [
        m.publishedVersion ? mono(`v${m.publishedVersion}`) : mono("—", { class: "dim" }),
      ]),
      el("td", {}, [mono(formatDateTime(m.updatedAt))]),
      actions,
    ]);
  };

  async function load(): Promise<void> {
    try {
      const maps = await ctx.api.listMaps(archived);
      // No maps is zero rows under the same headers. The table is the empty
      // state: it already says what would be here.
      tbody.replaceChildren(...maps.map(row));
    } catch (err) {
      ctx.notify(errorText(err), "error");
    }
  }

  const renderForm = () => {
    formSlot.replaceChildren();
    if (!formOpen) return;

    const title = el("input", {
      type: "text",
      class: "field-input",
      placeholder: "Title",
      maxlength: 200,
      "aria-label": "Map title",
    });

    let chosen: string | null = null;
    const options = el("div", { class: "choices", role: "radiogroup" });
    const renderOptions = () => {
      options.replaceChildren(
        ...[
          { id: null as string | null, title: "Blank", detail: "0 features" },
          ...templates.map((t) => ({
            id: t.id as string | null,
            title: t.title,
            detail: `${t.featureCount} features · ${t.uiDir}`,
          })),
        ].map((o) => {
          const b = el(
            "button",
            {
              type: "button",
              class: `choice${chosen === o.id ? " is-on" : ""}`,
              role: "radio",
              "aria-checked": String(chosen === o.id),
            },
            [el("span", {}, [o.title]), mono(o.detail, { class: "dim" })],
          );
          b.addEventListener("click", () => {
            chosen = o.id;
            // A template names the map until the author does.
            if (!title.value.trim() && o.id) title.value = o.title;
            renderOptions();
          });
          return b;
        }),
      );
    };
    renderOptions();

    const create = async () => {
      const value = title.value.trim();
      if (!value) {
        title.focus();
        return;
      }
      try {
        const map = await ctx.api.createMap(value, chosen);
        await ctx.refreshSession();
        ctx.navigate(`/maps/${map.id}`);
      } catch (err) {
        ctx.notify(errorText(err), "error");
      }
    };
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void create();
    });

    formSlot.append(
      el("div", { class: "newmap" }, [
        title,
        options,
        el("div", { class: "newmap-actions" }, [
          button("Create", () => void create(), "btn btn-primary"),
          button("Cancel", () => {
            formOpen = false;
            renderForm();
          }),
        ]),
      ]),
    );
    title.focus();
  };

  const node = el("div", { class: "page" }, [
    el("header", { class: "pagehead" }, [
      el("h1", {}, ["Maps"]),
      usage,
      el("span", { class: "spacer" }),
      canCreate &&
        button(
          "New map",
          () => {
            formOpen = !formOpen;
            renderForm();
          },
          "btn btn-primary",
        ),
    ]),
    formSlot,
    tabs,
    table,
  ]);

  renderUsage();
  renderTabs();
  void load();
  if (canCreate) {
    ctx.api
      .templates()
      .then((t) => {
        templates = t;
        renderForm();
      })
      .catch((err) => ctx.notify(errorText(err), "error"));
  }

  return { node };
}
