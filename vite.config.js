import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" makes asset paths relative, so the app works at any
// subpath — which is exactly how GitHub Pages serves a project site
// (https://usuario.github.io/nome-do-repo/).
export default defineConfig({
  base: "./",
  plugins: [react()],
});
