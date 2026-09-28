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
    // The suite must run in demo mode, and `.env.test` cannot guarantee that on
    // its own: a *process* variable outranks a dotenv file, so a shell that has
    // sourced `.env.local` (`set -a; . ./.env.local`, which is how the gateway
    // scripts here read their keys) puts real Clerk and Supabase values in front
    // of the app and fails the whole demo suite with "expected sample data"
    // errors. These explicit blanks beat both files and the shell alike.
    env: {
      VITE_CLERK_PUBLISHABLE_KEY: "",
      VITE_SUPABASE_URL: "",
      VITE_SUPABASE_ANON_KEY: "",
    },
  },
});
