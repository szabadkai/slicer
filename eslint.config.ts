import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // No `any` — use `unknown` + type guards
      '@typescript-eslint/no-explicit-any': 'error',

      // No @ts-ignore — use @ts-expect-error with justification
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-expect-error': 'allow-with-description',
        },
      ],

      // Explicit return types on exported functions
      '@typescript-eslint/explicit-module-boundary-types': 'error',

      // No default exports — named exports only
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'Use named exports only. No default exports.',
        },
      ],

      // No console.log — only warn/error allowed
      'no-console': ['error', { allow: ['warn', 'error'] }],

      // No wildcard imports
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['three', 'three/*'],
              message:
                'THREE.js imports are restricted to core/viewer-service.ts and features/gpu-slicing/**. Use the viewer service API instead.',
            },
          ],
        },
      ],
    },
  },

  // Allow THREE.js imports in viewer-service and gpu-slicing
  {
    files: [
      'src/core/viewer-service.ts',
      'src/features/gpu-slicing/**/*.ts',
      // Legacy files that directly use THREE — allowed until migrated to viewer-service
      'src/viewer.ts',
      'src/viewer-core.ts',
      'src/viewer-core-paint.ts',
      'src/viewer-core-intent.ts',
      'src/viewer-core-models.ts',
      'src/viewer-core-selection.ts',
      'src/viewer-undo.ts',
      'src/viewer-cut.ts',
      'src/viewer-plates.ts',
      'src/viewer-geometry.ts',
      'src/viewer-serialize.ts',
      'src/viewer-scene.ts',
      'src/repairer.ts',
      'src/supports.ts',
      'src/supports-geometry.ts',
      'src/features/support-generation/manual-pillar.ts',
      'src/features/hollow-drain/trap-actions.ts',
      'src/features/scene-viewer/measure.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  // Relaxed rules for legacy JS files during migration
  {
    files: ['src/**/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        console: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        HTMLElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        HTMLInputElement: 'readonly',
        Event: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        Worker: 'readonly',
        Image: 'readonly',
        ImageData: 'readonly',
        fetch: 'readonly',
        alert: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
    },
  },

  // Test files — allow non-null assertions for convenience
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Ignore build output and config files
  {
    ignores: ['dist/**', 'node_modules/**', '*.config.*'],
  },
);
