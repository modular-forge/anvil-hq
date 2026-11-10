// ESLint for the board: TypeScript and Angular rules on the code, and the Angular template rules,
// accessibility included, on the HTML.
//
// This file is TypeScript like the rest of the repository. `npm run lint` passes
// `--flag unstable_native_nodejs_ts_config` so that ESLint loads it with Node's own type
// stripping; without the flag ESLint needs the `jiti` package, one more dependency.

import angular from 'angular-eslint';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    files: ['src/**/*.ts'],
    extends: [...tseslint.configs.strict, ...tseslint.configs.stylistic, ...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/component-selector': ['error', { type: 'element', prefix: 'anv', style: 'kebab-case' }],
      '@angular-eslint/directive-selector': ['error', { type: 'attribute', prefix: 'anv', style: 'camelCase' }],
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      // Components without logic are plain decorated classes.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },
  {
    files: ['src/**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
    rules: {
      '@angular-eslint/template/prefer-control-flow': 'error',
    },
  },
);
