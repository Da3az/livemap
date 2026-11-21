import type { Session } from "./api.js";
import { button, el, formatDate, link, mono } from "./dom.js";

const STRIP_DISMISSED = "livemap.guest-strip-dismissed";

export interface Shell {
  readonly node: HTMLElement;
  /** Where pages are mounted. */
  readonly content: HTMLElement;
  setActive(section: "maps" | null): void;
  notify(text: string, kind: "info" | "error"): void;
}

/**
 * The frame every signed-in page sits in: a narrow rail that never changes, a
 * strip for the one fact a guest must not miss, the page, and a status line.
 */
export function createShell(session: Session, onSignOut: () => void): Shell {
  const maps = link("/maps", "Maps", "rail-item");

  const rail = el("nav", { class: "rail", "aria-label": "Main" }, [
    link("/maps", "livemap", "wordmark"),
    maps,
    // A full page load on purpose: the reference is served by the API, not by
    // this application.
    el("a", { href: "/docs", class: "rail-item" }, ["API"]),
    el("div", { class: "rail-foot" }, [
      mono(session.tenant.slug, { class: "rail-tenant", title: "Workspace" }),
      el("span", { class: "rail-role" }, [session.role]),
      button("Sign out", onSignOut, "btn-text"),
    ]),
  ]);

  const strip = el("div", { class: "strip" });
  // Per tab: dismissing it should not hide it for the whole week.
  if (session.guest && !sessionStorage.getItem(STRIP_DISMISSED)) {
    strip.append(
      el("span", {}, ["Temporary workspace"]),
      session.expiresAt
        ? mono(`expires ${formatDate(session.expiresAt)}`)
        : "",
      el("span", { class: "spacer" }),
      button(
        "Dismiss",
        () => {
          sessionStorage.setItem(STRIP_DISMISSED, "1");
          strip.replaceChildren();
        },
        "btn-text",
      ),
    );
  }

  const content = el("div", { class: "content" });
  const status = el("div", { class: "appstatus", role: "status" });
  let timer = 0;

  const node = el("div", { class: "shell" }, [
    rail,
    el("div", { class: "main" }, [strip, content, status]),
  ]);

  return {
    node,
    content,
    setActive(section) {
      maps.classList.toggle("is-on", section === "maps");
      if (section === "maps") maps.setAttribute("aria-current", "page");
      else maps.removeAttribute("aria-current");
    },
    notify(text, kind) {
      window.clearTimeout(timer);
      status.replaceChildren(
        el("span", { class: kind === "error" ? "msg-error" : "" }, [text]),
      );
      // Errors stay until replaced: a refusal read a second too late is a
      // refusal not read.
      if (kind === "info") {
        timer = window.setTimeout(() => status.replaceChildren(), 6000);
      }
    },
  };
}
