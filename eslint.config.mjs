import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '*.config.*'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Scoped to src/: parserOptions.project only covers the tsconfig's
    // include (src/**/*), so applying it to test/ or tooling files breaks
    // parsing. Type-aware linting uses tsconfig.eslint.json: the build
    // tsconfig excludes src/**/*.test.ts so tests are never emitted to
    // dist/, but they still must resolve under the lint project.
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-useless-assignment': 'off',
      'prefer-const': 'off',
    },
  },
  {
    files: ['examples/**/*.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  }
);
