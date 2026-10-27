import { defineConfig } from "vitest/config";

export default defineConfig({
  // Tests use stubbed fetches (see test/helpers.ts); the setup file fails any real network call.
  test: {
    testTimeout: 20_000,
    hookTimeout: 30_000,
    setupFiles: ["./test/no-network.setup.ts", "./test/messages-en.setup.ts", "./test/clock.setup.ts"],
    // `npm run coverage` (in the root) measures how much of the code the tests run.
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text-summary", "json-summary"],
      thresholds: { statements: 85 },
    },
  },
});
