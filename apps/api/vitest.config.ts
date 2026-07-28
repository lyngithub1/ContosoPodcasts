import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Keep Fastify's request logging out of the test output; assertions cover
    // behavior, and the auth suite asserts on the logger directly.
    env: {
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
    },
    // The auth suite calls vi.resetModules() and re-imports the module graph
    // (including `jose`) for each case. Under parallel load that can exceed the
    // 5s default and fail as a timeout rather than a real assertion.
    testTimeout: 20_000,
  },
});
