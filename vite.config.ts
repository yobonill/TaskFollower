import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative assets work both locally and under a GitHub Pages repository path.
  base: "./",
  server: {
    port: 43861,
    strictPort: true,
  },
  preview: {
    port: 43862,
    strictPort: true,
  },
});
