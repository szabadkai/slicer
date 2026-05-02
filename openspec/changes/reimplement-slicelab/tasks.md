## 1. Foundation: core, tests, and CI guards

- [ ] 1.1 Create `src/core/` with `event-bus.js` (typed pub/sub via JSDoc), `store.js` (observable project + UI state), and `viewer-service.js` (the only THREE.js entry point).
- [ ] 1.2 Add Vitest as a dev dependency and wire `npm test` to run `*.test.js` files colocated with feature modules.
- [ ] 1.3 Add `tsc --checkJs --noEmit` (with a minimal `tsconfig.json`) and run it in `npm test`.
- [ ] 1.4 Add a CI script that fails when any file under `src/` exceeds 600 LOC (`app-shell` requirement) and when `import * as THREE from 'three'` appears outside `src/core/viewer-service.js` or `src/features/gpu-slicing/**`.
- [ ] 1.5 Capture a golden slice output (PNG zip + per-layer pixel counts) for a fixture STL using the current `slicer.js`, store under `tests/fixtures/`, and add a regression test that re-slices it after every migration step.

## 2. Feature slice: `material-and-printer-profiles`

- [ ] 2.1 Move `src/materials.js` and the `PRINTERS` constant from `src/slicer.js` into `src/features/material-and-printer-profiles/{materials.js,printers.js}`.
- [ ] 2.2 Implement `panel.js` for material picker and printer modal that publishes `material:changed` and `printer:changed` on the bus.
- [ ] 2.3 Add `apply-to-all-plates` action that updates every plate via the store.
- [ ] 2.4 Vitest scenarios: library is non-empty, switching printer updates store dimensions, "apply to all" propagates.

## 3. Feature slice: `multi-plate-project`

- [ ] 3.1 Move `src/plates.js` into `src/features/multi-plate-project/plate.js` and add `tabs.js` for the tab-bar UI.
- [ ] 3.2 Move plate add/remove/rename/select handlers out of `main.js` into this feature, talking to the store only.
- [ ] 3.3 Implement `arrange.js` (XY bin-packing of plate models within build area) and wire the "Arrange" button.
- [ ] 3.4 Vitest scenarios: add/remove/rename, default-name renumbering preserves custom names, arrange yields non-overlapping XY.

## 4. Feature slice: `model-io`

- [ ] 4.1 Split `src/main.js` STL loading + drag-drop wiring into `src/features/model-io/load.js`.
- [ ] 4.2 Move autosave/restore from `src/project-store.js` into `src/features/model-io/autosave.js` and rebuild the restore-project modal in `app-shell`.
- [ ] 4.3 Move STL/OBJ/3MF/PNG-zip writing from `src/exporter.js` into `src/features/model-io/export.js`, keeping a slim `panel.js` for export controls.
- [ ] 4.4 Vitest scenarios: binary-STL parse, malformed-file error toast, autosave round-trip, PNG-zip manifest schema.

## 5. Feature slice: `layer-preview`

- [ ] 5.1 Extract layer canvas + slider DOM and JS from `src/main.js` into `src/features/layer-preview/canvas.js` and `panel.js`.
- [ ] 5.2 Extract the fullscreen layer inspector modal into `src/features/layer-preview/inspector-modal.js`; wire pan/zoom and arrow-key navigation.
- [ ] 5.3 Move `src/volume.js` and pixel readback into `src/features/layer-preview/volume.js`.
- [ ] 5.4 Vitest scenarios: slider range matches layer count, info text format, mesh-based pre-slice estimate marker, modal `Escape` close.

## 6. Feature slice: `mesh-health`

- [ ] 6.1 Split `src/inspector.js` (944 LOC) into `src/features/mesh-health/{detectors,issue-types.js,report.js}`; one file per detector.
- [ ] 6.2 Split `src/repairer.js` (627 LOC) into `src/features/mesh-health/repair/{close-holes.js,weld.js,normals.js,degenerate.js,winding.js,pipeline.js}`.
- [ ] 6.3 Implement `panel.js` (collapsed by default, opens on badge click); add badge component to model summary.
- [ ] 6.4 Vitest scenarios: hole detection, normals fix, transform preserved across repair, badge color transitions.

## 7. Feature slice: `support-generation`

- [ ] 7.1 Split `src/supports.js` (1,117 LOC) into `src/features/support-generation/{detect.js,sample.js,route.js,build.js,base-pan.js,index.js}`; keep `index.js` as the public `generateSupports(geometry, opts)` API.
- [ ] 7.2 Move support panel DOM + handlers from `src/main.js` into `src/features/support-generation/panel.js`; per-model storage lives in the store.
- [ ] 7.3 Vitest scenarios: angle threshold filtering, auto-density proportionality, tip diameter accuracy, base-pan margin/thickness, "clear" scope.

## 8. Feature slice: `auto-orientation`

- [ ] 8.1 Move `src/orientation.js` and `src/orientation.worker.js` into `src/features/auto-orientation/{engine.js,worker.js}`; switch worker construction to `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`.
- [ ] 8.2 Implement `panel.js` with strategy preset selector, protected-face picker, progress UI, preview, and apply/dismiss flow.
- [ ] 8.3 Vitest scenarios: 26 candidates evaluated, strategy weights pick expected orientation on fixture meshes, cancel terminates worker, dismiss reverts rotation.

## 9. Feature slice: `gpu-slicing`

- [ ] 9.1 Split `src/slicer.js` (548 LOC) into `src/features/gpu-slicing/{pipeline.js,passes.js,params.js,cache.js,index.js}`; keep WebGL/THREE imports confined here.
- [ ] 9.2 Implement per-plate cache invalidation listening to `geometry:changed`, `supports:changed`, `printer:changed`, `slice-params:changed` events.
- [ ] 9.3 Implement `panel.js` with parameters, slice / slice-all / cancel buttons, and print-time estimate.
- [ ] 9.4 Vitest scenarios: layer count math, cube interior pixel area, cancel within one layer, cache hit on plate switch, estimate updates with exposure.

## 10. Feature slice: `scene-viewer` and `model-transform`

- [ ] 10.1 Split `src/viewer.js` (2,084 LOC) into `src/core/viewer-service.js` (scene/camera/renderer), `src/features/scene-viewer/{lighting.js,grid.js,build-volume.js,picking.js,gizmos.js,resin-material.js,panel.js}`.
- [ ] 10.2 Move transform gizmo wiring + numeric inputs into `src/features/model-transform/{ops.js,panel.js}`.
- [ ] 10.3 Implement undo/redo on the store (≥ 20 steps) for transforms.
- [ ] 10.4 Vitest scenarios: gizmo mode shortcuts, drop-to-plate min-Z = 0, undo/redo of translate, resin material updates per material change.

## 11. Feature slice: `app-shell` and UI re-stage

- [ ] 11.1 Rebuild `index.html` panel structure into the five workflow stages (`Prepare`, `Orient`, `Support`, `Slice`, `Export`) with a separate inspector slot.
- [ ] 11.2 Implement `src/features/app-shell/{stages.js,inspector.js,modals/,shortcuts.js,layout.css}`; keep a per-feature CSS file colocated with each panel and split `style.css` accordingly.
- [ ] 11.3 Move printer-chooser, restore-project, shortcuts, and layer-inspector dialogs into `app-shell/modals/`; ensure focus trap and `Escape` close.
- [ ] 11.4 Add `?` shortcut and shortcut help dialog covering stage navigation, gizmo modes, frame view, undo/redo, slice, toggle sidebar.
- [ ] 11.5 Vitest scenarios: stage tab swaps panel, inspector swaps with stage, modal Escape closes, shortcut dialog lists every registered shortcut.

## 12. Cleanup and acceptance

- [ ] 12.1 Delete unused state and DOM wiring from the old `src/main.js`; reduce it to a < 100 LOC bootstrap that imports `core/` and feature `mount()` functions.
- [ ] 12.2 Remove temporary `legacy/` shims used during migration.
- [ ] 12.3 Confirm CI guards pass: every `src/` file ≤ 600 LOC, no stray THREE imports.
- [ ] 12.4 Run the golden-slice regression to confirm pixel-identical output across the migration.
- [ ] 12.5 Run `openspec validate reimplement-slicelab --strict` and `openspec archive reimplement-slicelab` to promote the specs into `openspec/specs/`.
- [ ] 12.6 Update `README.md` with the new architecture diagram and contributor instructions ("each capability has a folder under `src/features/`; see `openspec/specs/<capability>/spec.md`").
