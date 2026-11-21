import { ApiError, type Api, type ClientConfig } from "../api.js";
import { button, el } from "../dom.js";
import { errorText, type Page } from "../ctx.js";

interface Turnstile {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
      theme?: "light" | "dark" | "auto";
    },
  ): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

const TURNSTILE_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Loaded only when a site key is configured; a deployment without one never contacts the host. */
function loadTurnstile(): Promise<Turnstile> {
  const w = window as unknown as { turnstile?: Turnstile };
  if (w.turnstile) return Promise.resolve(w.turnstile);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = TURNSTILE_SRC;
    s.async = true;
    s.onload = () =>
      w.turnstile ? resolve(w.turnstile) : reject(new Error("check unavailable"));
    s.onerror = () => reject(new Error("check unavailable"));
    document.head.append(s);
  });
}

export function signinPage(
  api: Api,
  config: ClientConfig,
  onSignedIn: () => void,
  notice: string | null,
): Page {
  const status = el("p", { class: "signin-status", role: "status" }, [
    notice ?? "",
  ]);
  const say = (text: string) => {
    status.textContent = text;
  };

  let widget: { api: Turnstile; id: string } | null = null;
  let humanToken: string | null = null;

  const guest = button(
    "Continue as guest",
    () => {
      void (async () => {
        guest.disabled = true;
        say("Creating a workspace…");
        try {
          const { token } = await api.guest(humanToken);
          api.setToken(token);
          onSignedIn();
        } catch (err) {
          say(
            err instanceof ApiError && err.code === "guest_capacity"
              ? "Guest workspaces are full at the moment. Try again later."
              : err instanceof ApiError && err.code === "human_check_failed"
                ? "The check did not pass. Try it again."
                : errorText(err),
          );
          // A token is good for one attempt; ask for a fresh one.
          humanToken = null;
          if (widget) widget.api.reset(widget.id);
          guest.disabled = Boolean(config.humanCheckSiteKey);
        }
      })();
    },
    "btn btn-primary",
  );

  const check = el("div", { class: "signin-check" });
  if (config.guestSignup && config.humanCheckSiteKey) {
    const sitekey = config.humanCheckSiteKey;
    guest.disabled = true;
    loadTurnstile()
      .then((t) => {
        const id = t.render(check, {
          sitekey,
          theme: "light",
          callback: (token) => {
            humanToken = token;
            guest.disabled = false;
          },
          "expired-callback": () => {
            humanToken = null;
            guest.disabled = true;
          },
          "error-callback": () => say("The check could not be completed."),
        });
        widget = { api: t, id };
      })
      .catch(() => say("The check could not be loaded, so guest access is unavailable."));
  }

  const tokenInput = el("input", {
    type: "password",
    class: "signin-token mono",
    placeholder: "Session token",
    autocomplete: "off",
    spellcheck: "false",
    id: "signin-token",
  });
  const useToken = async () => {
    const value = tokenInput.value.trim();
    if (!value) return;
    api.setToken(value);
    try {
      await api.me();
      onSignedIn();
    } catch (err) {
      api.setToken(null);
      say(
        err instanceof ApiError && err.status === 401
          ? "That token was not accepted."
          : errorText(err),
      );
    }
  };
  tokenInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void useToken();
  });

  const node = el("main", { class: "signin" }, [
    el("div", { class: "signin-col" }, [
      el("h1", { class: "wordmark" }, ["livemap"]),
      el("p", { class: "signin-what" }, [
        "Draw regions, movements and front lines on a map, then publish it as an embed that updates in place.",
      ]),

      config.guestSignup &&
        el("section", { class: "signin-block" }, [
          check,
          guest,
          el("p", { class: "signin-terms" }, [
            "A guest workspace is a real one, reachable only from this browser. It is deleted after seven days.",
          ]),
        ]),

      el("section", { class: "signin-block" }, [
        el("label", { class: "signin-label", for: "signin-token" }, [
          "Have a session token?",
        ]),
        el("div", { class: "signin-row" }, [
          tokenInput,
          button("Sign in", () => void useToken()),
        ]),
      ]),

      status,
      el("p", { class: "signin-foot" }, [
        el("a", { href: "/docs" }, ["API reference"]),
      ]),
    ]),
  ]);

  return {
    node,
    destroy: () => {
      if (widget) widget.api.remove(widget.id);
    },
  };
}
