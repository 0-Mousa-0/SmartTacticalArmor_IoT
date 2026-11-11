import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * Clean-architecture dependency rule, enforced by the linter:
 *   presentation -> application -> domain <- data
 * The domain layer is plain TypeScript; the data layer never touches the UI.
 */
const layerRule = (forbidden, message) => ({
  'no-restricted-imports': ['error', { patterns: [{ group: forbidden, message }] }],
});

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['src/features/*/domain/**/*.ts'],
    rules: layerRule(
      ['react', 'react-*', '@tanstack/*', '**/data/**', '**/application/**', '**/presentation/**', '@/core/http/*'],
      'Domain layer must stay framework-free (clean architecture).',
    ),
  },
  {
    files: ['src/features/*/data/**/*.ts'],
    rules: layerRule(
      ['react', 'react-*', '**/application/**', '**/presentation/**'],
      'Data layer must not depend on the application or presentation layers.',
    ),
  },
  {
    files: ['src/features/*/application/**/*.{ts,tsx}'],
    rules: layerRule(['**/presentation/**', '**/data/**'], 'Application layer depends on domain interfaces only.'),
  },
);
