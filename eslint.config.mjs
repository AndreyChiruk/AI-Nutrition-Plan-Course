import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '**/*.js']
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': plugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
];