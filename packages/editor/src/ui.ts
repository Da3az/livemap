// Nothing here may position by `left`/`right`: the shell mirrors under
// `dir="rtl"` from editor.css logical properties alone. Text-bearing values
// carry their own explicit `dir`, set on the element.

import type { MapFeature } from "@livemap/core";
import type { EditorStore } from "./store.js";
import type { DrawController, ToolDefaults, ToolId } from "./draw.js";

export const ICON_CHOICES: readonly { id: string; label: string }[] = [
  { id: "evt:strike", label: "Strike" },
  { id: "evt:fire", label: "Fire" },
  { id: "evt:displaced", label: "Displaced" },
  { id: "evt:checkpoint", label: "Checkpoint" },
  { id: "evt:aid", label: "Aid" },
];

export const PALETTE: readonly string[] = [
  "#E03C31",
  "#E8731A",
  "#E8A33D",
  "#1F7A4C",
  "#2B5FD9",
  "#7C3AED",
  "#16130f",
  "#6B6257",
];

const TOOLS: readonly { id: ToolId; label: string; hint: string }[] = [
  { id: "select", label: "Select", hint: "V" },
  { id: "area", label: "Area", hint: "A" },
  { id: "line", label: "Line", hint: "L" },
  { id: "arrow", label: "Arrow", hint: "R" },
  { id: "frontline", label: "Front line", hint: "F" },
  { id: "point", label: "Icon", hint: "I" },
  { id: "annotation", label: "Note", hint: "N" },
];

const KIND_LABEL: Record<MapFeature["kind"], string> = {
  area: "Area",
  line: "Line",
  arrow: "Arrow",
  frontline: "Front line",
  point: "Icon",
  annotation: "Note",
};

type Attrs = Record<string, string | number | boolean | undefined>;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === "class") node.className = String(v);
    else if (k.startsWith("on")) continue;
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    node.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

function field(label: string, control: HTMLElement): HTMLElement {
  return el("label", { class: "field" }, [
    el("span", { class: "field-label" }, [label]),
    control,
  ]);
}

function numberInput(
  value: number,
  opts: { min?: number; max?: number; step?: number },
  onChange: (v: number) => void,
): HTMLInputElement {
  const input = el("input", {
    type: "number",
    value: String(value),
    min: opts.min,
    max: opts.max,
    step: opts.step ?? 1,
  });
  input.addEventListener("change", () => onChange(Number(input.value)));
  return input;
}

function rangeInput(
  value: number,
  opts: { min: number; max: number; step: number },
  onChange: (v: number) => void,
): HTMLInputElement {
  const input = el("input", {
    type: "range",
    value: String(value),
    min: opts.min,
    max: opts.max,
    step: opts.step,
  });
  input.addEventListener("input", () => onChange(Number(input.value)));
  return input;
}

function select<T extends string>(
  value: T,
  options: readonly { value: T; label: string }[],
  onChange: (v: T) => void,
): HTMLSelectElement {
  const s = el("select");
  for (const o of options) {
    const opt = el("option", { value: o.value, selected: o.value === value }, [
      o.label,
    ]);
    s.append(opt);
  }
  s.addEventListener("change", () => onChange(s.value as T));
  return s;
}

function swatches(current: string, onPick: (c: string) => void): HTMLElement {
  const row = el("div", { class: "swatches" });
  for (const c of PALETTE) {
    const b = el("button", {
      class: `swatch${c === current ? " is-on" : ""}`,
      type: "button",
      title: c,
      "aria-label": `Colour ${c}`,
    });
    b.style.background = c;
    b.addEventListener("click", () => onPick(c));
    row.append(b);
  }
  return row;
}

function toggle(
  label: string,
  checked: boolean,
  onChange: (v: boolean) => void,
): HTMLElement {
  const input = el("input", { type: "checkbox", checked });
  input.addEventListener("change", () => onChange(input.checked));
  return el("label", { class: "toggle" }, [input, el("span", {}, [label])]);
}

export interface UIHooks {
  onSave: () => void;
  onPublish: () => void;
  onPreview: () => void;
  onToggleDir: () => void;
}

export class EditorUI {
  private readonly toolbar: HTMLElement;
  private readonly inspector: HTMLElement;
  private readonly featureList: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly inspectorPanel: HTMLElement;
  private readonly listPanel: HTMLElement;
  private message = "";
  private messageKind: "info" | "error" = "info";
  /** The feature list is opened by the author; the inspector by a selection. */
  private listOpen = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly store: EditorStore,
    private readonly drawer: DrawController,
    private readonly defaults: ToolDefaults,
    private readonly hooks: UIHooks,
  ) {
    this.toolbar = root.querySelector(".toolbar")!;
    this.inspector = root.querySelector(".inspector-body")!;
    this.featureList = root.querySelector(".feature-list")!;
    this.statusEl = root.querySelector(".status")!;
    this.inspectorPanel = this.inspector.closest<HTMLElement>(".panel")!;
    this.listPanel = this.featureList.closest<HTMLElement>(".panel")!;
  }

  setMessage(text: string, kind: "info" | "error" = "info"): void {
    this.message = text;
    this.messageKind = kind;
    this.renderStatus();
    if (text) {
      window.setTimeout(() => {
        if (this.message === text) {
          this.message = "";
          this.renderStatus();
        }
      }, 6000);
    }
  }

  render(): void {
    this.syncPanels();
    this.renderToolbar();
    this.renderInspector();
    this.renderFeatureList();
    this.renderStatus();
  }

  /**
   * The side column exists only while it has something to show. With nothing
   * selected and the list closed it is absent — not an empty panel explaining
   * that it is empty — and the map has the full width.
   */
  private syncPanels(): void {
    const selected = this.store.selected !== null;
    this.inspectorPanel.hidden = !selected;
    this.listPanel.hidden = !this.listOpen;
    this.root.classList.toggle("has-panel", selected || this.listOpen);
  }

  private renderToolbar(): void {
    this.toolbar.replaceChildren();

    const tools = el("div", { class: "tool-group tools" });
    for (const t of TOOLS) {
      const active = this.drawer.currentTool === t.id;
      const b = el(
        "button",
        {
          class: `tool${active ? " is-on" : ""}`,
          type: "button",
          title: `${t.label} (${t.hint})`,
          "aria-pressed": active,
        },
        [t.label, el("kbd", {}, [t.hint])],
      );
      b.addEventListener("click", () => {
        this.drawer.setTool(t.id);
        this.render();
      });
      tools.append(b);
    }
    this.toolbar.append(tools);

    // Defaults for the next shape drawn, not the selection — and only the ones
    // the active tool will use. A stroke width beside the icon tool is a
    // control that does nothing.
    const d = this.defaults;
    const tool = this.drawer.currentTool;
    const next = el("div", { class: "tool-group defaults" });
    const strokes = tool === "line" || tool === "arrow" || tool === "frontline";

    if (tool === "area" || tool === "point" || strokes) {
      next.append(
        swatches(d.color, (c) => {
          d.color = c;
          this.render();
        }),
      );
    }
    if (tool === "area" || strokes) {
      const width = numberInput(
        d.strokeWidth,
        { min: 1, max: 20, step: 0.5 },
        (v) => {
          d.strokeWidth = v;
        },
      );
      width.title = "Stroke width";
      width.setAttribute("aria-label", "Stroke width");
      next.append(width);
    }
    if (tool === "point") {
      const icon = select(
        d.icon,
        ICON_CHOICES.map((i) => ({ value: i.id, label: i.label })),
        (v) => {
          d.icon = v;
        },
      );
      icon.setAttribute("aria-label", "Icon");
      next.append(icon);
    }
    this.toolbar.append(next);

    const actions = el("div", { class: "tool-group actions" });

    const undo = el("button", { class: "btn", type: "button", title: "Undo (Ctrl+Z)" }, ["Undo"]);
    undo.disabled = !this.store.canUndo;
    undo.addEventListener("click", () => this.store.undo());

    const redo = el("button", { class: "btn", type: "button", title: "Redo (Ctrl+Shift+Z)" }, ["Redo"]);
    redo.disabled = !this.store.canRedo;
    redo.addEventListener("click", () => this.store.redo());

    const count = this.store.list().length;
    const list = el(
      "button",
      {
        class: `btn${this.listOpen ? " is-on" : ""}`,
        type: "button",
        "aria-pressed": this.listOpen,
      },
      [`Features ${count}`],
    );
    list.addEventListener("click", () => {
      this.listOpen = !this.listOpen;
      this.render();
    });

    const dir = el("button", { class: "btn", type: "button", title: "Toggle interface direction" }, ["RTL / LTR"]);
    dir.addEventListener("click", this.hooks.onToggleDir);

    const preview = el("button", { class: "btn", type: "button" }, ["Preview"]);
    preview.addEventListener("click", this.hooks.onPreview);

    const save = el("button", { class: "btn", type: "button", title: "Save (Ctrl+S)" }, ["Save"]);
    save.addEventListener("click", this.hooks.onSave);

    actions.append(undo, redo, list, dir, preview, save);
    this.toolbar.append(actions);

    // Publishing is the one action here that changes what readers see, so it
    // stands apart from the rest, with the state it would change beside it.
    const version = this.store.document?.publishedVersion;
    const publish = el("button", { class: "btn btn-primary", type: "button" }, ["Publish"]);
    publish.addEventListener("click", this.hooks.onPublish);
    this.toolbar.append(
      el("div", { class: "tool-group publish" }, [
        el("span", { class: "publish-state" }, [
          version ? `v${version} live` : "not published",
        ]),
        publish,
      ]),
    );
  }

  private renderInspector(): void {
    this.inspector.replaceChildren();
    const f = this.store.selected;

    // Nothing selected: the panel is hidden by `syncPanels`, so there is
    // nothing to say here.
    if (!f) return;

    this.inspector.append(
      el("div", { class: "inspector-head" }, [
        el("strong", {}, [KIND_LABEL[f.kind]]),
        el("code", {}, [f.id]),
      ]),
    );

    const patch = (p: Partial<MapFeature>) => this.store.update(f.id, p);

    // Colour applies to every kind, but lands on a different property.
    const currentColor =
      f.kind === "area"
        ? f.fill.color
        : f.kind === "point"
          ? f.iconColor
          : f.kind === "annotation"
            ? f.labelStyle.color
            : f.stroke.color;

    this.inspector.append(
      field(
        "Colour",
        swatches(currentColor, (c) => {
          if (f.kind === "area") {
            patch({ fill: { ...f.fill, color: c }, stroke: { ...f.stroke, color: c } } as Partial<MapFeature>);
          } else if (f.kind === "point") {
            patch({ iconColor: c } as Partial<MapFeature>);
          } else if (f.kind === "annotation") {
            patch({
              labelStyle: { ...f.labelStyle, color: c },
              ...(f.leader ? { leader: { ...f.leader, color: c } } : {}),
            } as Partial<MapFeature>);
          } else {
            patch({ stroke: { ...f.stroke, color: c } } as Partial<MapFeature>);
          }
        }),
      ),
    );

    if (f.kind === "area") {
      this.inspector.append(
        field(
          "Fill opacity",
          rangeInput(f.fill.opacity, { min: 0, max: 1, step: 0.02 }, (v) =>
            patch({ fill: { ...f.fill, opacity: v } } as Partial<MapFeature>),
          ),
        ),
        field(
          "Border width",
          numberInput(f.stroke.width, { min: 0, max: 20, step: 0.5 }, (v) =>
            patch({ stroke: { ...f.stroke, width: v } } as Partial<MapFeature>),
          ),
        ),
        toggle("Dashed border", Boolean(f.stroke.dash), (on) =>
          patch({
            stroke: on
              ? { ...f.stroke, dash: [2, 1.5] }
              : { color: f.stroke.color, width: f.stroke.width, opacity: f.stroke.opacity },
          } as Partial<MapFeature>),
        ),
      );
    }

    if (f.kind === "line" || f.kind === "arrow" || f.kind === "frontline") {
      this.inspector.append(
        field(
          "Width",
          numberInput(f.stroke.width, { min: 1, max: 20, step: 0.5 }, (v) =>
            patch({ stroke: { ...f.stroke, width: v } } as Partial<MapFeature>),
          ),
        ),
      );
    }

    if (f.kind === "arrow") {
      this.inspector.append(
        field(
          "Curvature",
          rangeInput(f.curvature, { min: 0, max: 1, step: 0.02 }, (v) =>
            patch({ curvature: v } as Partial<MapFeature>),
          ),
        ),
        field(
          "Head",
          select(
            f.head,
            [
              { value: "single" as const, label: "Single" },
              { value: "double" as const, label: "Double" },
              { value: "none" as const, label: "None" },
            ],
            (v) => patch({ head: v } as Partial<MapFeature>),
          ),
        ),
        toggle("Chevrons along shaft", f.chevrons, (on) =>
          patch({ chevrons: on } as Partial<MapFeature>),
        ),
      );
    }

    if (f.kind === "frontline") {
      this.inspector.append(
        field(
          "Teeth face",
          select(
            f.facing,
            [
              { value: "left" as const, label: "Left of travel" },
              { value: "right" as const, label: "Right of travel" },
            ],
            (v) => patch({ facing: v } as Partial<MapFeature>),
          ),
        ),
      );
    }

    if (f.kind === "point") {
      this.inspector.append(
        field(
          "Icon",
          select(
            f.icon,
            ICON_CHOICES.map((i) => ({ value: i.id, label: i.label })),
            (v) => patch({ icon: v } as Partial<MapFeature>),
          ),
        ),
        field(
          "Size",
          rangeInput(f.iconSize, { min: 0.5, max: 2.5, step: 0.05 }, (v) =>
            patch({ iconSize: v } as Partial<MapFeature>),
          ),
        ),
      );
    }

    if (f.kind === "annotation") {
      const textarea = el("textarea", { rows: 3 }, [f.text.value]);
      textarea.addEventListener("input", () =>
        patch({ text: { ...f.text, value: textarea.value } } as Partial<MapFeature>),
      );
      // Mirror the box so Arabic is authored in the direction it reads.
      textarea.dir = f.text.dir;

      this.inspector.append(
        field("Text", textarea),
        field(
          "Text direction",
          select(
            f.text.dir,
            [
              { value: "auto" as const, label: "Auto-detect" },
              { value: "rtl" as const, label: "Right to left" },
              { value: "ltr" as const, label: "Left to right" },
            ],
            (v) => patch({ text: { ...f.text, dir: v } } as Partial<MapFeature>),
          ),
        ),
        field(
          "Text size",
          numberInput(f.labelStyle.size, { min: 8, max: 36, step: 1 }, (v) =>
            patch({ labelStyle: { ...f.labelStyle, size: v } } as Partial<MapFeature>),
          ),
        ),
        field(
          "Label offset X",
          numberInput(f.offset[0], { min: -400, max: 400, step: 2 }, (v) =>
            patch({ offset: [v, f.offset[1]] } as Partial<MapFeature>),
          ),
        ),
        field(
          "Label offset Y",
          numberInput(f.offset[1], { min: -400, max: 400, step: 2 }, (v) =>
            patch({ offset: [f.offset[0], v] } as Partial<MapFeature>),
          ),
        ),
        field(
          "Leader",
          select(
            f.leader ? f.leader.shape : "none",
            [
              { value: "straight" as const, label: "Straight" },
              { value: "elbow" as const, label: "Elbow" },
              { value: "none" as const, label: "No leader" },
            ],
            (v) =>
              patch({
                leader:
                  v === "none"
                    ? null
                    : {
                        color: f.labelStyle.color,
                        width: 1.2,
                        dash: [2, 1.5],
                        shape: v,
                        anchorDot: true,
                      },
              } as Partial<MapFeature>),
          ),
        ),
      );
    }

    // Labels are optional on everything except annotations, which ARE a label.
    if (f.kind !== "annotation") {
      const labelInput = el("input", {
        type: "text",
        value: f.label?.value ?? "",
        placeholder: "Optional label",
      });
      labelInput.dir = f.label?.dir ?? "auto";
      labelInput.addEventListener("change", () =>
        patch({
          label: labelInput.value
            ? { value: labelInput.value, dir: f.label?.dir ?? "auto" }
            : undefined,
          labelStyle: f.labelStyle ?? {
            color: "#16130f",
            haloColor: "#ffffff",
            haloWidth: 1.6,
            size: 13,
          },
        } as Partial<MapFeature>),
      );
      this.inspector.append(field("Label", labelInput));
    }

    const row = el("div", { class: "inspector-actions" });
    const up = el("button", { class: "btn", type: "button", title: "Bring forward" }, ["↑"]);
    up.addEventListener("click", () => this.store.reorder(f.id, "up"));
    const down = el("button", { class: "btn", type: "button", title: "Send backward" }, ["↓"]);
    down.addEventListener("click", () => this.store.reorder(f.id, "down"));
    const dup = el("button", { class: "btn", type: "button" }, ["Duplicate"]);
    dup.addEventListener("click", () => this.store.duplicate(f.id));
    const del = el("button", { class: "btn btn-danger", type: "button", title: "Delete (Del)" }, ["Delete"]);
    del.addEventListener("click", () => {
      this.store.markDeleted(f.id);
      this.store.remove(f.id);
    });
    row.append(up, down, dup, del);
    this.inspector.append(row);
  }

  private renderFeatureList(): void {
    this.featureList.replaceChildren();
    const items = this.store.list().reverse(); // topmost first

    if (!this.listOpen) return;

    for (const f of items) {
      const active = this.store.selectedId === f.id;
      const row = el("button", {
        class: `feature-row${active ? " is-on" : ""}`,
        type: "button",
      });
      const dot = el("span", { class: "dot" });
      dot.style.background =
        f.kind === "area"
          ? f.fill.color
          : f.kind === "point"
            ? f.iconColor
            : f.kind === "annotation"
              ? f.labelStyle.color
              : f.stroke.color;

      const name =
        f.kind === "annotation"
          ? f.text.value
          : (f.label?.value ?? KIND_LABEL[f.kind]);

      // The label, or the kind when there is none. Never both: an unlabelled
      // icon used to read "Icon … Icon".
      const nameEl = el("span", { class: "feature-name" }, [name || KIND_LABEL[f.kind]]);
      if (f.kind === "annotation") nameEl.dir = f.text.dir;
      else if (f.label) nameEl.dir = f.label.dir;

      row.append(dot, nameEl);
      row.addEventListener("click", () => this.store.select(f.id));
      this.featureList.append(row);
    }
  }

  private renderStatus(): void {
    this.statusEl.replaceChildren();
    const count = this.store.list().length;
    const doc = this.store.document;

    this.statusEl.append(
      el("span", {}, [`${count} feature${count === 1 ? "" : "s"}`]),
      el("span", { class: "sep" }, ["·"]),
      el("span", {}, [`rev ${this.store.revision}`]),
      el("span", { class: "sep" }, ["·"]),
      el("span", { class: this.store.isDirty ? "dirty" : "clean" }, [
        this.store.isDirty ? "unsaved changes" : "saved",
      ]),
    );

    if (doc?.publishedVersion) {
      this.statusEl.append(
        el("span", { class: "sep" }, ["·"]),
        el("span", {}, [`published v${doc.publishedVersion}`]),
      );
    }

    if (this.message) {
      this.statusEl.append(
        el("span", { class: `msg msg-${this.messageKind}` }, [this.message]),
      );
    }
  }
}
