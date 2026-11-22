/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "http" makes a development build talk to a running server instead of the mock. */
  readonly VITE_API?: "http" | "mock";
  /** Where the API is served, when not the page's own origin. */
  readonly VITE_API_BASE?: string;
}
