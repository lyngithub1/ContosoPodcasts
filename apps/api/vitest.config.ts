import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Keep Fastify's request logging out of the test output; assertions cover
    // behavior, and the auth suite asserts on the logger directly.
    env: {
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
    },
  },
});
