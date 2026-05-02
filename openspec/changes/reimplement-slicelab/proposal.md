## Why

SliceLab is a working browser-based SLA/DLP resin slicer, but it has grown into a hard-to-evolve monolith: `src/main.js` is ~4,600 lines, `src/viewer.js` is ~2,100 lines, and `src/supports.js` is ~1,100 lines. These oversized files slow agent inference, make small features risky, and have produced a flat, modal-heavy UI that mixes unrelated concerns (transform, supports, slicing, materials, repair) at the same level. There are no recorded specifications, so behavior cannot be validated without reading the implementation.

This change captures the existing application as a set of small, testable capability specs and proposes a re-implementation that fixes the structural pitfalls: oversized modules, ad-hoc DOM wiring in `main.js`, and a convoluted single-pane UI.

## What Changes

- **Establish initial specifications** for every user-visible capability of SliceLab so the app can be re-implemented from spec rather than from source.
- **BREAKING** Replace the global `main.js` "god module" with a feature-sliced architecture where each capability owns its module(s), public API, and panel component (target: no source file > 600 LOC).
- **BREAKING** Replace the flat sidebar of seven coexisting panels with a workflow-staged UI (Prepare → Orient → Support → Slice → Export) and an inspector pattern for tool detail.
- Introduce an event-bus / store boundary so capabilities communicate via typed events instead of cross-importing each other and reading shared module-level state.
- Move the WebGL scene, BVH acceleration, and slicer GPU pipeline behind a thin viewer service so non-render code never touches THREE directly.
- Keep the existing runtime stack (Vite, vanilla JS/ES modules, Three.js, three-mesh-bvh, JSZip) and existing material/printer presets so the re-implementation is incremental and the live deployment URL stays stable.

## Capabilities

### New Capabilities

- `model-io`: Load STL files (drag-drop & file picker), validate, normalize units, manage the in-memory model registry, project autosave/restore, and export to STL / OBJ / 3MF / sliced PNG zip with metadata.
- `scene-viewer`: 3D scene, camera, lighting, build-volume box, grid, selection, picking, transform gizmos, and resin material preview shader.
- `model-transform`: Translate / rotate / scale operations on selected models, snapping, multi-select, undo/redo of transforms.
- `mesh-health`: Geometry inspection (non-manifold edges, flipped normals, holes, self-intersections, thin walls), severity report, and one-click repair pipeline.
- `auto-orientation`: Candidate orientation generation, genetic-algorithm refinement in a Web Worker, scoring weights (speed / supports / surface), and protected-face constraint.
- `support-generation`: Overhang detection at a configurable angle, auto/manual density, tip tapering, cross-bracing, base pan with lip, and per-model support visibility & deletion.
- `material-and-printer-profiles`: Built-in resin presets (Siraya, Anycubic, Elegoo, etc.) and printer presets (Anycubic, Elegoo, Phrozen, Creality, UniFormation, Formlabs); apply per-plate or to all plates.
- `gpu-slicing`: Stencil-buffer based per-layer rasterization on WebGL, layer-thickness / exposure parameters, bottom layers, lift profile, and cancellable batch slicing per plate.
- `layer-preview`: Scrub layers, fullscreen layer inspector, pixel volume read-back, and print-time estimation.
- `multi-plate-project`: Multiple build plates with isolated models and slice caches, plate add/remove/rename, arrange/pack action.
- `app-shell`: Workflow-staged sidebar, command palette / shortcuts, modals (printer chooser, restore project, layer inspector), responsive layout, theming.

### Modified Capabilities

<!-- None: this is the first set of specs for the project. -->

## Impact

- **Code**: Whole `src/` tree is restructured into `src/features/<capability>/` plus a small `src/core/` (event bus, store, viewer service). Existing files (`main.js`, `viewer.js`, `slicer.js`, `supports.js`, `orientation.js`, `inspector.js`, `repairer.js`, `materials.js`, `plates.js`, `exporter.js`, `volume.js`, `project-store.js`) are split and rehomed.
- **HTML/CSS**: `index.html` (~35 KB) and `style.css` (~37 KB) are split per feature panel; the sidebar markup is regenerated from the new workflow stages.
- **APIs**: No external HTTP API. The internal contract becomes per-capability ES module exports + a typed event bus; cross-module DOM querying is removed.
- **Dependencies**: No new runtime deps required. Optional dev-time additions: a lightweight test runner (Vitest) and a typing layer (JSDoc + `tsc --checkJs`) to keep modules small and verifiable.
- **Deployment**: GitHub Pages build via `vite build` is unchanged. The live URL (`https://szabadkai.github.io/slicer/`) keeps working through the migration because each capability is ported behind the same public behavior.
- **Performance**: Smaller files reduce agent context cost per edit; BVH and GPU paths are unchanged so runtime perf is preserved or improved.
