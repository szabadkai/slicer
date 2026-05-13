# Contributing

## UI Directives

- **Progress Bars & Yielding:** Make sure operations that might take along time are showing the user a progress bar. You must also guarantee that the browser has an opportunity to paint the UI progress bar text before any synchronous heavy work begins and during iterations of long tasks. Use `showProgress(text)` and `hideProgress()`, and make sure you yield the main thread right after using `await new Promise(r => setTimeout(r, 50))` so the browser paints the UI correctly. For loops traversing large arrays, periodically yield and update `onProgress` text or percentages to avoid freezing the browser canvas.

## Raycasting Meshes

- **Always use `DoubleSide` for collision-detection meshes.** When creating a temporary `THREE.Mesh` for raycasting (e.g., support route collision checks), use `new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })`. The default `FrontSide` culls backfaces, which means rays from inside the mesh (common in support planning) silently miss all faces.

## Support System

- **Pillar store is the source of truth.** Never set `SceneObject.supportsMesh` directly. Mutate the pillar store (`pillar-store.ts`) and call `rebuildSupportsFromStore`.
- **Undo before mutating.** Dispatch `CustomEvent('pillar-edit-undo-save', { detail: { modelId } })` before any pillar store mutation.
- **LegacyViewer + AppContext.** When adding new viewer methods, add them to both `viewer.ts` and `LegacyViewer` in `core/legacy-types.ts`. When adding new `AppContext` fields, also add a stub in `main.ts`.

See `docs/SUPPORT_SYSTEM_ARCHITECTURE.md` for the full architecture reference.
