// The whole view layer: create an element, set what it needs, append children.
// Small enough that a framework would be more code than what it replaced.

export type Child = Node | string | null | undefined | false;

type Attrs = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = String(v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c);
  }
  return node;
}

/** Machine data — ids, etags, versions, sizes, timestamps — is always set in mono. */
export function mono(text: string, attrs: Attrs = {}): HTMLElement {
  const cls = attrs["class"] ? `mono ${String(attrs["class"])}` : "mono";
  return el("span", { ...attrs, class: cls }, [text]);
}

/** An in-app link. The router intercepts the click; the href still works without it. */
export function link(href: string, text: string, cls = ""): HTMLAnchorElement {
  return el("a", { href, "data-link": true, class: cls }, [text]);
}

export function button(
  text: string,
  onClick: () => void,
  cls = "btn",
): HTMLButtonElement {
  const b = el("button", { type: "button", class: cls }, [text]);
  b.addEventListener("click", onClick);
  return b;
}

const DATE = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
});
const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatDate = (iso: string): string => DATE.format(new Date(iso));
export const formatDateTime = (iso: string): string =>
  DATE_TIME.format(new Date(iso));

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
