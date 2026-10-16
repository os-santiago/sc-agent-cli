import { defineConfig } from 'vitest/config';

// Opt-in sandbox integration suite (#544, split out of #481): exercises
// run_shell through a REAL bubblewrap boundary instead of the injected fake
// backend the unit tests use. Never part of the default `npm test` unit
// suite — lives under test/sandbox/, run via `npm run test:sandbox`.
//
// Every suite is double-gated by the tests themselves:
//   SC_SANDBOX_TESTS=1  — explicit opt-in (CI sets it on the Linux leg only)
//   hasBwrap()          — host can actually build the boundary, else
//                         describe.skipIf degrades to an all-skipped pass
// Coverage thresholds do NOT apply here — the floor is scoped to the unit
// suite (vitest.config.ts) alone.
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/sandbox/**/*.test.ts'],
    // Real namespace setup + spawns — keep timeouts generous.
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
