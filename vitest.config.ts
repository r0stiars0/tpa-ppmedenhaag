import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      /**
       * The logic modules, which is what this suite is for: the pure
       * derivations, the queries behind them, and everything in
       * `netlify/functions/lib` that runs holding the service-role key.
       * Components are exercised by Playwright and by
       * `scripts/verify-push.mjs` against a real browser rather than
       * here, so including them would report a number about the wrong
       * thing.
       */
      include: ['src/lib/**', 'netlify/functions/lib/**'],
      // Generated from the database schema by the Supabase CLI; there is
      // no behaviour in it to cover.
      exclude: ['src/lib/database.types.ts'],
      reporter: ['text', 'html'],
    },
  },
})
