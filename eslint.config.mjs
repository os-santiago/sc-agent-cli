import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '*.config.*'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Scoped to src/: parserOptions.project only covers tsconfig's include
    // (src/**/*), so applying it to test/ or tooling files breaks parsing.
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        TextDecoder: 'readonly',
        URLSearchParams: 'readonly',
        AbortSignal: 'readonly',
        AbortController: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        Headers: 'readonly',
      },
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
    },
  }
);