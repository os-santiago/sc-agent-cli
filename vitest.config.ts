import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    testTimeout: 30000,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Emit the coverage report even when tests fail — a red suite must not
      // silently swallow the coverage output (#509).
      reportOnFailure: true,
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/types/**',
      ],
      thresholds: {
        statements: 10,
        branches: 8,
        functions: 20,
        lines: 10,
      },
    },
  },
});
