import { defineConfig } from "vitest/config";

export default defineConfig({
  // Tests use stubbed fetches (see test/helpers.ts); the setup file fails any real network call.
  test: { testTimeout: 20_000, hookTimeout: 30_000, setupFiles: ["./test/no-network.setup.ts"] },
});
