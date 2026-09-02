import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __CSG_DEBUG_BUILD__: 'true' },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['tests/**/*.test.ts']
  }
});
