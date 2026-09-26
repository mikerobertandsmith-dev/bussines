import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: { port: 5173, host: true, allowedHosts: true },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
    restoreMocks: true,
  },
});
