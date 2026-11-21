// Boot, session and routing. Four screens and a sign-in page: small enough
// that the router is a function and the state is a handful of variables.

import { Api, ApiError, type ClientConfig, type Session } from "./api.js";
import { errorText, type Ctx, type Page } from "./ctx.js";
import { el, link } from "./dom.js";
import { createShell, type Shell } from "./shell.js";
import { signinPage } from "./pages/signin.js";
import { mapsPage } from "./pages/maps.js";
import { editorPage } from "./pages/editor.js";
import { versionsPage } from "./pages/versions.js";

const root = document.getElementById("app")!;
const api = new Api();

let config: ClientConfig;
let session: Session | null = null;
let shell: Shell | null = null;
let page: Page | null = null;
/** The path being shown, so a refused back-navigation can be put back. */
let shownPath = location.pathname;
/** Carried onto the sign-in page: why the visitor is seeing it again. */
let signinNotice: string | null = null;

type Route =
  | { readonly name: "maps" }
  | { readonly name: "editor"; readonly id: string }
  | { readonly name: "versions"; readonly id: string }
  | { readonly name: "unknown" };

function parse(path: string): Route {
  if (path === "/maps" || path === "/maps/") return { name: "maps" };
  const versions = /^\/maps\/([^/]+)\/versions\/?$/.exec(path);
  if (versions) return { name: "versions", id: versions[1]! };
  const editor = /^\/maps\/([^/]+)\/?$/.exec(path);
  if (editor) return { name: "editor", id: editor[1]! };
  return { name: "unknown" };
}

function leave(): void {
  page?.destroy?.();
  page = null;
}

function show(next: Page, into: HTMLElement): void {
  leave();
  page = next;
  into.replaceChildren(next.node);
  next.mounted?.();
}

function signOut(notice: string | null): void {
  api.setToken(null);
  session = null;
  shell = null;
  signinNotice = notice;
  history.replaceState(null, "", "/");
  void render();
}

function unknownPage(): Page {
  return {
    node: el("div", { class: "page" }, [
      el("header", { class: "pagehead" }, [el("h1", {}, ["No such page"])]),
      el("p", { class: "plain" }, [link("/maps", "Back to maps")]),
    ]),
  };
}

async function render(): Promise<void> {
  shownPath = location.pathname;

  if (!api.token) {
    session = null;
    shell = null;
    if (location.pathname !== "/") history.replaceState(null, "", "/");
    shownPath = "/";
    const notice = signinNotice;
    signinNotice = null;
    show(
      signinPage(
        api,
        config,
        () => {
          history.replaceState(null, "", "/maps");
          void render();
        },
        notice,
      ),
      root,
    );
    return;
  }

  if (!session) {
    try {
      session = await api.me();
    } catch (err) {
      // A rejected token has already been cleared by the client, and the
      // sign-in page is on its way. Anything else is worth saying.
      if (!(err instanceof ApiError && err.status === 401)) {
        leave();
        root.replaceChildren(
          el("main", { class: "signin" }, [
            el("div", { class: "signin-col" }, [
              el("h1", { class: "wordmark" }, ["livemap"]),
              el("p", { class: "signin-status" }, [errorText(err)]),
            ]),
          ]),
        );
      }
      return;
    }
  }

  if (location.pathname === "/") {
    history.replaceState(null, "", "/maps");
    shownPath = "/maps";
  }

  if (!shell) {
    shell = createShell(session, () => signOut(null));
    leave();
    root.replaceChildren(shell.node);
  }
  const frame = shell;
  const current = session;

  const ctx: Ctx = {
    api,
    config,
    session: current,
    navigate,
    notify: (text, kind = "info") => frame.notify(text, kind),
    refreshSession: async () => {
      session = await api.me();
    },
  };

  const route = parse(location.pathname);
  frame.setActive(route.name === "unknown" ? null : "maps");

  switch (route.name) {
    case "maps":
      show(mapsPage(ctx), frame.content);
      break;
    case "editor":
      show(editorPage(ctx, route.id), frame.content);
      break;
    case "versions":
      show(versionsPage(ctx, route.id), frame.content);
      break;
    case "unknown":
      show(unknownPage(), frame.content);
      break;
  }
}

function navigate(path: string): void {
  if (path === location.pathname) return;
  if (page?.canLeave && !page.canLeave()) return;
  history.pushState(null, "", path);
  void render();
}

api.onUnauthorized = () => {
  // Deferred: this fires from inside a request some page is still awaiting.
  queueMicrotask(() =>
    signOut(
      "Your session has ended. A guest workspace lasts seven days; a token until it expires.",
    ),
  );
};

// In-app links are ordinary anchors, so they open in a new tab, copy and
// middle-click like any other. Only a plain left click is taken over.
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest?.("a[data-link]");
  if (!(a instanceof HTMLAnchorElement)) return;
  e.preventDefault();
  navigate(new URL(a.href).pathname);
});

window.addEventListener("popstate", () => {
  // Back cannot be cancelled, only undone: if the page refuses to be left,
  // the entry the browser just moved away from is pushed again.
  if (page?.canLeave && !page.canLeave()) {
    history.pushState(null, "", shownPath);
    return;
  }
  void render();
});

api
  .config()
  .then((c) => {
    config = c;
    return render();
  })
  .catch((err) => {
    root.replaceChildren(
      el("main", { class: "signin" }, [
        el("div", { class: "signin-col" }, [
          el("h1", { class: "wordmark" }, ["livemap"]),
          el("p", { class: "signin-status" }, [
            `The server could not be reached: ${errorText(err)}`,
          ]),
        ]),
      ]),
    );
  });
