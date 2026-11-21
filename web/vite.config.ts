import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Several dev servers at once must not share one optimiser cache.
  cacheDir: process.env.VITE_CACHE_DIR ?? "node_modules/.vite",
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    dedupe: ["react", "react-dom", "maplibre-gl"],
  },
  server: { port: 5180, strictPort: true },
  preview: { port: 5181, strictPort: true },
  build: {
    rolldownOptions: {
      output: {
        /*
         * MapLibre is about 1 MB minified on its own. Keeping it in one named chunk
         * makes it plain that only the routes that draw a map (editor, versions,
         * embed, the sign-in specimen) load it.
         */
        codeSplitting: { groups: [{ name: "maplibre", test: /node_modules[\\/]maplibre-gl[\\/]/ }] },
      },
    },
  },
});
