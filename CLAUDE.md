# CLAUDE.md

## Project overview

SliceLab is a browser-based SLA/DLP resin slicer built with TypeScript + THREE.js + Vite. No backend. All geometry processing and GPU slicing happens client-side. The codebase is ~25k LOC TypeScript.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # Vitest
npm run typecheck  # tsc --noEmit
```

## Architecture

**Feature-sliced layout.** Every capability lives in `src/features/<name>/`. Features import from `src/core/` but never from each other. Cross-feature communication uses DOM `CustomEvent` dispatch.

**Viewer delegate pattern.** The 3D viewer (`src/viewer.ts`) extends `ViewerCore` (`src/viewer-core.ts`) and delegates groups of methods to smaller files to stay under 600 LOC:
- `viewer-supports.ts` — support mesh management
- `viewer-plates.ts` — multi-plate operations
- `viewer-geometry.ts` — geometry queries
- `viewer-serialize.ts` — project save/restore
- `viewer-undo.ts` — undo/redo stack
- `viewer-cut.ts` — cut plane operations
- `viewer-core-selection.ts` — selection, raycasting, click handling
- `viewer-core-models.ts` — model add/remove
- `viewer-core-paint.ts` — paint tool
- `viewer-core-intent.ts` — surface intent painting
- `viewer-core-overhang.ts` — overhang overlay

**Legacy types.** The viewer's public API is typed via `LegacyViewer` in `src/core/legacy-types.ts`. Feature panels receive the viewer as `AppContext.viewer: LegacyViewer`. When adding new viewer methods, you MUST add them to both `viewer.ts` and `LegacyViewer` in `legacy-types.ts`, or panels will get type errors.

**AppContext.** The shared context object wired through `mountApp` in `src/features/app-shell/mount.ts`. Initially constructed in `src/main.ts` with stub functions, then filled by `mountApp` and various `mount*` calls. When adding new fields to `AppContext` (in `src/core/types.ts`), also add a stub in `main.ts`.

## Coding conventions

- **Files <= 600 LOC.** Split by concern when approaching the limit.
- **No `any`.** Use `unknown` + type guards. Explicit return types on exports.
- **Path aliases:** `@core/*` maps to `src/core/`, `@features/*` maps to `src/features/`.
- **No cross-feature imports.** Features communicate via events on `document` or `viewer.canvas`.
- **Progress bars for long ops.** Use `ctx.showProgress()` / `ctx.hideProgress()` and yield with `await new Promise(r => setTimeout(r, 50))` so the browser can paint. See `CONTRIBUTING.md`.
- **THREE.js imports** should be confined to viewer files and geometry processing files. Feature panels should not import THREE directly — use the `LegacyViewer` interface instead.

## Key subsystems

### Support generation

See `docs/SUPPORT_SYSTEM_ARCHITECTURE.md` for the full architecture doc. Key facts:

- **Pillar store** (`src/features/support-generation/pillar-store.ts`) is the source of truth. A `Map<modelId, ModelPillarSet>` holds all pillars (auto + manual) with their routes, dimensions, and settings.
- **`supportsMesh`** on each `SceneObject` is a derived view — rebuilt by `rebuildSupportsMesh()` from the pillar store. Never manipulate `supportsMesh` directly; always go through the pillar store.
- **Four contact-point detectors** run in `generateSupports()` (in `supports.ts`). Overhangs always run; minima and stabilization default on; reinforcements default off. All live in `src/supports-detect.ts`. Each emits `ContactPoint[]` tagged with a `reason` field (`'overhang' | 'minima' | 'stabilization' | 'reinforcement'`). Results are merged and deduplicated before route planning. The `reason` feeds per-pillar sizing overrides (reinforcement contacts get a thicker tip).
- **BVH is built once, upfront.** `generateSupports` calls `geometry.computeBoundsTree()` before any detector runs. The reinforcement detector reuses this via `RouteContext`. Do not move or skip the BVH build.
- **Route planning** (`src/supports.ts: planSupportRoute`) finds a collision-free path from contact point to build plate. `routeCollides` in `supports-geometry.ts` validates routes.
- **Collision mesh must use `DoubleSide`.** The temp mesh used for raycasting in `supports.ts` and `manual-pillar.ts` MUST use `THREE.MeshBasicMaterial({ side: THREE.DoubleSide })`. Without it, rays shot from inside the model won't detect faces because backfaces are culled.
- **Undo** for support edits uses `pillar-edit` entries in the undo stack (see `viewer-undo.ts`). Components dispatch `CustomEvent('pillar-edit-undo-save', { detail: { modelId } })` before mutating the store; the viewer listens and snapshots.
- **Right-click delete** works only when the supports panel is active. `viewer-core-selection.ts: handleSupportContextMenu` raycasts support meshes and fires `support-right-clicked`. `panel.ts` listens and calls `viewer.removePillarAndRebuild`.
- **Serialization** saves `pillarSet` alongside the legacy `supports` mesh field. Pre-rework projects load with `legacyOpaque: true` — the opaque mesh is displayed until the user runs auto-gen or adds a manual pillar, at which point per-pillar editing takes over.

### Viewer undo system

Three entry types in the undo stack:
1. **Object snapshots** — clones of all mesh geometry/material/position (default path)
2. **Multi-plate snapshots** — same but across all plates
3. **Pillar-edit entries** — `{ type: 'pillar-edit', modelId, previousPillarSet }` — lightweight, only stores the pillar data

The `undo()` and `redo()` functions check the entry type and dispatch to the appropriate restore logic. Pillar-edit entries are snapshotted BEFORE the undo stack is pushed (the current state goes to redo, the entry's stored state is restored).

### Serialization / project persistence

`viewer-serialize.ts` handles save/restore. Projects autosave to IndexedDB. The `SerializedObject` type in `project-store.ts` defines the on-disk format. When adding new per-object state, add a field to `SerializedObject`, serialize in `serializeObjects`, and restore in `restoreSerializedObjects` with a fallback for older saves.

## Testing

```bash
npm test              # all tests
npx vitest run <path> # single file
```

Tests use Vitest. THREE.js geometry tests work without a DOM (THREE's buffer geometry is pure math). Tests that need the pillar store should call `_resetPillarStoreForTests()` in `beforeEach`.

## Definition of done

Before marking any task complete, verify:

1. **Tests pass** — `npm test`
2. **Typecheck passes** — `npm run typecheck`
3. **Docs are current** — if the change affects user-visible behaviour or architecture, update the relevant file in `docs/` (user guides in `docs/guides/`, internals in `docs/SUPPORT_SYSTEM_ARCHITECTURE.md` etc.)

## Common pitfalls

- **Forgetting `LegacyViewer`**: Adding a method to `viewer.ts` without adding it to `LegacyViewer` in `legacy-types.ts` causes type errors in all feature panels that use `ctx.viewer`.
- **Forgetting `AppContext` stub**: Adding a field to `AppContext` in `core/types.ts` without adding a stub in `main.ts` causes a TS error at bootstrap.
- **FrontSide raycasting**: Any temp mesh used for collision raycasting (e.g. in support route planning) MUST use `side: THREE.DoubleSide`. Otherwise rays from inside the mesh geometry won't detect faces.
- **Reinforcement detector near-value**: `detectReinforcements` sets `raycaster.near = 0.05` to skip the self-intersection from the same triangle's back face (DoubleSide). Lowering this below 0.05 causes thick walls to get false-positive reinforcement contacts.
- **`queueMicrotask` for deferred rebuild**: When restoring serialized objects, the pillar store is populated before objects are added to plates. `rebuildSupportsFromStore` needs `findObjectAnywhere` to succeed, so the rebuild must be deferred (we use `queueMicrotask`).
- **Event-based cross-feature communication**: Features can't import from each other. Use `document.dispatchEvent(new CustomEvent(...))` for cross-feature signals (e.g., `pillar-edit-undo-save`, `manual-support-failed`, `supports-generated`, `tool-panel-changed`).
