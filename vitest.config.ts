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
      reporter: ['text', 'json-summary', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/types/**',
        // #544 — the src/tools/** per-file floor below ignores files with no
        // executable surface: declaration files, pure type modules and pure
        // barrel index.ts files. tool.ts is the Tool/ToolContext interface —
        // `import type` + interfaces only, it compiles to `export {}` with
        // zero coverable statements (#545).
        'src/tools/**/*.d.ts',
        'src/tools/**/types.ts',
        'src/tools/**/index.ts',
        'src/tools/tool.ts',
      ],
      thresholds: {
        statements: 40,
        branches: 30,
        functions: 45,
        lines: 40,
        // #481/#544 — hard per-file floor for the tool layer: the code that
        // mutates the filesystem, spawns processes and touches the network.
        // perFile makes every file under src/tools/** a gate of its own —
        // a zero-test file can no longer hide behind the aggregate. Glob
        // blocks don't inherit the top-level perFile, so it is set here.
        'src/tools/**': {
          statements: 60,
          lines: 60,
          functions: 60,
          branches: 50,
          perFile: true,
        },
      },
    },
  },
});
