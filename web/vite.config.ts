/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// `vite build --mode online-demo` builds the online demo for box3balans.nl/demo/: no server, it
// answers from recorded demo data (src/staticDemo.ts, scripts/build-online-demo.js).
export default defineConfig(({ mode }) => {
  const onlineDemo = mode === "online-demo";
  return {
    plugins: [react(), tailwindcss()],
    base: onlineDemo ? "/demo/" : "/",
    define: { __STATIC_DEMO__: JSON.stringify(onlineDemo) },
    build: { outDir: onlineDemo ? "dist-demo" : "dist" },
    server: {
      port: 5173,
      proxy: { "/api": "http://localhost:8080" },
    },
    // `npm run coverage` (in the root) measures how much of the code the tests run.
    test: {
      coverage: {
        provider: "v8",
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["src/**/*.test.*", "src/test/**", "src/main.tsx"],
        reporter: ["text-summary", "json-summary"],
        thresholds: { statements: 60 },
      },
    },
  };
});
