// vitest.config.ts — D7 backend test configuration
// Two test suites:
//   - unit: fast, no I/O (classifier, pure functions)
//   - integration: server + mocked external deps

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Global timeout — integration tests start HTTP servers
    testTimeout: 15_000,
    hookTimeout: 10_000,

    // Environment
    environment: "node",

    // Exclude stray manual test scripts that call real APIs and use process.exit().
    // src/routes/decompose.test.ts is a manual smoke-check (calls real Anthropic API,
    // uses process.exit()), not a Vitest suite. Running it in CI crashes the test runner.
    exclude: [
      "**/node_modules/**",
      "src/routes/decompose.test.ts",
      "src/test/integration/budget.test.ts",
      "src/test/integration/decompose.test.ts",
    ],

    // Coverage (opt-in via --coverage flag)
    coverage: {
      provider: "v8",
      include:  ["src/**/*.ts"],
      exclude:  ["src/test/**", "src/**/*.test.ts"],
    },

    // Separate pools for unit vs integration to avoid port conflicts
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true, // run integration tests sequentially — each starts its own port
      },
    },
  },
});
