import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    testTimeout: 30000,
    include: ['src/**/*.test.ts'],
    // Pin the C locale inside test workers so assertions on git/bwrap stderr
    // stay deterministic on non-English developer machines. Spawned children
    // inherit process.env (and run_shell's env scrub allowlists LC_ALL), so
    // the pin reaches the tools whose output the tests match (#574).
    env: {
      LC_ALL: 'C',
    },
    coverage: {
      provider: 'v8',
      // Emit the coverage report even when tests fail — a red suite must not
      // silently swallow the coverage output (#509).
      reportOnFailure: true,
      reporter: ['text', 'json-summary', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/types/**',
      ],
      thresholds: {
        statements: 40,
        branches: 30,
        functions: 45,
        lines: 40,
      },
    },
  },
});
