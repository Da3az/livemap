import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import type { ApiClient } from "@/api/client";
import { AppProviders } from "@/app/providers";
import { router } from "@/app/router";
import "./index.css";

/*
 * A tab opened before a deploy (or a rebuild) still holds the old index.html,
 * whose lazily loaded chunks are gone from the server. Loading one fails; one
 * reload fetches the new page. The timestamp stops a loop if the reload does
 * not help, and the failure then surfaces as it would have.
 */
const RELOADED_KEY = "livemap.chunk-reload";
window.addEventListener("vite:preloadError", (event) => {
  try {
    const last = Number(window.sessionStorage.getItem(RELOADED_KEY) ?? 0);
    if (Date.now() - last < 10_000) return;
    window.sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

const root = createRoot(document.getElementById("root")!);

/*
 * Which API the app talks to. A production build always uses the server
 * (packages/api, same origin unless VITE_API_BASE says otherwise), and the
 * mock is not even in it. `npm run dev` uses the in-memory mock, with its seed
 * maps, personas and the /dev/states gallery; `VITE_API=http npm run dev`
 * talks to a running server through the dev proxy instead.
 */
async function createApi(): Promise<ApiClient> {
  if (import.meta.env.DEV && import.meta.env.VITE_API !== "http") {
    const { createMockApiClient } = await import("@/api/mock");
    return createMockApiClient();
  }
  const { createHttpApiClient } = await import("@/api/http");
  return createHttpApiClient(import.meta.env.VITE_API_BASE ?? "");
}

createApi()
  .then((api) => {
    root.render(
      <StrictMode>
        <AppProviders api={api}>
          <RouterProvider router={router} />
        </AppProviders>
      </StrictMode>,
    );
  })
  .catch(() => {
    root.render(
      <p role="alert" className="p-8 font-ui text-sm text-ink">
        The application could not be loaded. Check the connection and reload the page.
      </p>,
    );
  });
