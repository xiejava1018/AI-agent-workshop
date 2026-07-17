import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import path from "path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@imgs": path.resolve(__dirname, "src/assets/images"),
      "@views": path.resolve(__dirname, "src/views"),
      "@icons": path.resolve(__dirname, "src/assets/icons"),
      "@utils": path.resolve(__dirname, "src/utils"),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    // Silence static asset imports (images, styles) in tests
    deps: {
      inline: [/element-plus/],
    },
  },
});
