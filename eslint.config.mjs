// ESLint (audit A11 / HEALTH-9): a deliberately small rule set, run in CI (`npm run lint`).
// - react-hooks: rules-of-hooks + exhaustive-deps — a stale closure in a money editor saves a
//   stale total; every disable carries its reason on the same line.
// - @typescript-eslint/no-floating-promises: an un-awaited promise drops its error silently. A
//   deliberate fire-and-forget is written `void promise` (the rule's own escape hatch).
// src/shared/fixtures/ holds frozen copies of old code (differential tests) and is not linted.
// Formatting and style are not linted. A new rule goes here with its reason.
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'site/**', 'node_modules/**', 'scripts/**', 'resources/**', '**/*.d.ts', 'src/shared/fixtures/**'] },
  {
    files: ['src/**/*.{ts,tsx}', 'electron.vite.config.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error'
    }
  },
  // Hooks exist only in the renderer; main / shared have plain functions named use… (usePerfDataRoot,
  // applySetOff's use()), which the hook rules would misread.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error'
    }
  }
)
