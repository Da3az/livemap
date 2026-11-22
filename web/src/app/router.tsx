import { lazy, Suspense } from "react";
import { createBrowserRouter, Outlet } from "react-router";

const SignIn = lazy(() => import("@/screens/signin"));
const Workspace = lazy(() => import("@/screens/workspace"));
const Editor = lazy(() => import("@/screens/editor"));
const Versions = lazy(() => import("@/screens/versions"));
const Embed = lazy(() => import("@/screens/embed"));

/*
 * The development pages drive the in-memory mock and its personas. They exist
 * only in a development build: behind `import.meta.env.DEV`, a production
 * build leaves out their code and the mock with it.
 */
function devRoutes() {
  if (!import.meta.env.DEV) return [];
  const DevStates = lazy(() => import("@/screens/dev"));
  const EngineHarness = lazy(() => import("@/editor/engine/harness"));
  const ExtrasHarness = lazy(() => import("@/screens/editor/extras/harness"));
  const KitPage = lazy(() => import("@/components/ui/__kit__"));
  return [
    { path: "/dev/states/*", element: <DevStates /> },
    /* The map engine on its own, for checking rendering and drawing. */
    { path: "/dev/engine", element: <EngineHarness /> },
    /* The editor's secondary panels on their own. */
    { path: "/dev/extras", element: <ExtrasHarness /> },
    /* Every ui component in every state. */
    { path: "/dev/kit", element: <KitPage /> },
  ];
}

function Root() {
  return (
    <Suspense fallback={null}>
      <Outlet />
    </Suspense>
  );
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: "/", element: <SignIn /> },
      { path: "/maps", element: <Workspace /> },
      { path: "/maps/:id", element: <Editor /> },
      { path: "/maps/:id/versions", element: <Versions /> },
      /* What a reader sees: the published map, as it sits in an article's iframe. */
      { path: "/embed/:tenant/:slug", element: <Embed /> },
      ...devRoutes(),
    ],
  },
]);
