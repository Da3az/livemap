import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { AppProviders } from "@/app/providers";
import { router } from "@/app/router";
import "./index.css";

const root = createRoot(document.getElementById("root")!);

/*
 * The mock API, with its seed maps and gazetteer, is a chunk of its own that
 * loads beside the first screen's code rather than inside the main bundle.
 * INTEGRATION.md describes replacing it with an HTTP client.
 */
import("@/api/mock")
  .then(({ createMockApiClient }) => {
    root.render(
      <StrictMode>
        <AppProviders api={createMockApiClient()}>
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
