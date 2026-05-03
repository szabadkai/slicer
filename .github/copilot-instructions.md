# Agent Workflow

This project uses specialized agents managed by dropPod.

## The Team

| Agent | Role |
|-------|------|
| `@critical-thinking-mode-instructions` | Challenge assumptions and encourage critical thinking to ensure the best possibl |
| `@wg-code-sentinel` | Ask WG Code Sentinel to review your code for security issues. |
| `@universal-janitor` | Perform janitorial tasks on any codebase including cleanup, simplification, and  |

---

# Project Rules

This is a browser-based SLA/DLP resin slicer being reimplemented with a feature-sliced architecture. All new code MUST follow these rules.

## Architecture

- **Feature-sliced layout**: `src/features/<capability>/` for each feature, `src/core/` for shared infrastructure.
- **State**: `@preact/signals-core` — shared state lives in `src/core/state.ts` as exported signals. Use `signal()`, `computed()`, `effect()`, and `batch()`.
- **Commands**: `src/core/commands.ts` — imperative fire-and-forget actions (slice, export, cancel). Not for reactive state.
- **Viewer service**: `src/core/viewer-service.ts` — the ONLY entry point for THREE.js. Features never import `three` directly.
- **No cross-feature imports**: Features import from `@core/` only, never from other features. Communication happens via signals or commands.
- **Mount pattern**: Features expose `mount(rootEl, ctx)` where `ctx: MountContext = { viewer, commands }`. State is imported directly from `@core/state`.

## TypeScript

- Full TypeScript with `strict: true`. All new files are `.ts`.
- **No `any`** — use `unknown` + type guards when the type is truly unknown.
- **No `@ts-ignore`** — use `@ts-expect-error` with a justification comment if absolutely necessary.
- **Explicit return types** on all exported functions.
- **No default exports** — named exports only (easier to search, refactor, auto-import).
- Types shared across features go in `src/core/types.ts`.

## File Size & Structure

- Every source file in `src/` must be ≤ 600 lines of code.
- `src/main.ts` must be ≤ 100 lines (bootstrap only).
- Split large files by concern: `panel.ts` (UI), `ops.ts`/`engine.ts` (domain logic), `worker.ts` (async heavy-lifting).
- No barrel `index.ts` re-exports.

## Import Boundaries

- `three` and `three/*` imports are ONLY allowed in:
  - `src/core/viewer-service.ts`
  - `src/features/gpu-slicing/**`
- Use path aliases: `@core/*` for `src/core/*`, `@features/*` for `src/features/*`.
- No circular imports. No wildcard imports (`import *`).

## State Management (Signals)

- No module-level mutable state (`let x = ...` at file top level). Use signals.
- Shared state: import from `@core/state`.
- Local/feature state: create signals within the feature module.
- Derived state: use `computed()`, not manual recalculation.
- Side effects: use `effect()` with proper disposal.
- Batch multiple signal writes with `batch()` to avoid intermediate renders.

## Code Style

- **Formatting**: Prettier (single quotes, 2-space indent, 100 char width, trailing commas).
- **Naming**: `camelCase` for variables/functions, `PascalCase` for types/interfaces/classes, `UPPER_SNAKE_CASE` for constants, `kebab-case` for file names.
- **No `console.log`** — use `console.warn` or `console.error` only.
- Keep functions small and focused. Prefer pure functions for domain logic.

## Testing

- Every feature must have at least one co-located `*.test.ts` file.
- Use Vitest (`describe`, `it`, `expect`, `vi`).
- Tests are typed — no `any` in test files either.
- GPU slicing: golden PNG fixture test (pixel count within 1% tolerance).
- Workers: test via `happy-dom` integration tests.

## Examples

### Signal usage (correct)
```ts
import { selectedMaterialId, activePlate } from '@core/state';
import { effect } from '@preact/signals-core';

export function mountMaterialPanel(root: HTMLElement): () => void {
  const dispose = effect(() => {
    const mat = selectedMaterialId.value;
    root.querySelector('.current-material')!.textContent = mat;
  });
  return dispose;
}
```

### Command dispatch (correct)
```ts
import { commands } from '@core/commands';

commands.dispatch('slice', { plateId: activePlate.value!.id });
```

### WRONG — do not do this
```ts
// ❌ Direct three import outside viewer-service/gpu-slicing
import * as THREE from 'three';

// ❌ Module-level mutable state
let currentMaterial = 'grey';

// ❌ Cross-feature import
import { detectOverhangs } from '@features/support-generation/detect';

// ❌ Default export
export default function myPanel() { }

// ❌ any type
function process(data: any) { }
```
