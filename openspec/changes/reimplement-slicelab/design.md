## Context

SliceLab is a single-page web app that runs entirely in the browser, using Vite + vanilla ES modules + Three.js. The current source layout puts almost all DOM wiring, state, and orchestration in one file:

```diagram
╭───────────────────────────────────────────────────────────────╮
│ index.html (~35 KB markup, 7 sidebar panels + 4 modals)       │
╰───────────┬───────────────────────────────────────────────────╯
            │ querySelector / addEventListener
            ▼
╭───────────────────────────────────────────────────────────────╮
│ src/main.js (4,574 LOC: state + DOM + orchestration)          │
╰─┬─────────┬─────────┬──────────┬──────────┬─────────┬─────────╯
  │         │         │          │          │         │
  ▼         ▼         ▼          ▼          ▼         ▼
viewer.js orientation.js supports.js inspector.js slicer.js exporter.js
(2084)    (318+351 wkr) (1117)     (944)        (548)     (276)
                          + repairer.js (627), materials.js, plates.js, ...
```

Pain points observed in the workspace today:

- **Oversized files**: `main.js` 4,574 LOC, `viewer.js` 2,084 LOC, `supports.js` 1,117 LOC, `inspector.js` 944 LOC. These exceed comfortable agent-context windows for editing tasks and consistently slow down inference per turn.
- **No public boundary**: features import each other's internals; `main.js` reads/writes shared module-level state (`viewer`, `slicer`, `slicedLayers`, `project`).
- **DOM coupling**: every panel queries elements by id from `main.js`, so adding/renaming UI requires touching the monolith.
- **Convoluted UI**: seven coexisting tool panels (`edit`, `transform`, `orient`, `supports`, `materials`, `health`, `slice`) plus modals are all mounted at once, with overlapping concepts.
- **No specs / no tests**: behavior is only documented by source. There is no automated verification.

## Goals / Non-Goals

**Goals:**
- Capture every user-visible capability as a spec under `openspec/specs/` so the app can be re-implemented from spec rather than from source.
- Establish a feature-sliced architecture where every source file stays under ~600 LOC and each capability has a clear public surface.
- Replace the flat sidebar with a workflow-staged UI that hides advanced detail behind progressive disclosure.
- Keep runtime behavior, GPU slicing algorithm, BVH usage, presets, and live URL stable.

**Non-Goals:**
- Switching frameworks (no React/Svelte/Vue migration; vanilla JS stays).
- Replacing Three.js or the stencil-buffer slicing algorithm.
- Adding networked features, accounts, or a backend.
- Adding new printer/material presets beyond the existing set.
- Mobile/touch redesign — desktop-first stays.

## Decisions

### 1. Feature-sliced layout under `src/features/<capability>/`

Each capability listed in the proposal owns a folder:

```diagram
src/
├── core/
│   ├── event-bus.js         # tiny pub/sub, typed via JSDoc
│   ├── store.js             # observable project + UI state
│   └── viewer-service.js    # the only module that imports three directly
├── features/
│   ├── model-io/            # load.js, export.js, autosave.js, panel.js
│   ├── scene-viewer/        # camera.js, gizmos.js, picking.js, panel.js
│   ├── model-transform/     # ops.js, panel.js
│   ├── mesh-health/         # inspector.js, repairer.js, panel.js
│   ├── auto-orientation/    # engine.js, worker.js, panel.js
│   ├── support-generation/  # detect.js, route.js, build.js, panel.js
│   ├── material-and-printer-profiles/
│   ├── gpu-slicing/         # pipeline.js, params.js, panel.js
│   ├── layer-preview/       # canvas.js, inspector-modal.js, panel.js
│   ├── multi-plate-project/ # plate.js, tabs.js, arrange.js
│   └── app-shell/           # workflow-stages.js, modals/, shortcuts.js
└── main.js                  # < 100 LOC: bootstraps shell + features
```

**Why**: this keeps every file small and lets one agent edit one capability without loading the rest of the project. Existing `viewer.js` / `supports.js` / `inspector.js` will be split along their internal section comments (e.g. `supports.js` -> `detect.js`, `route.js`, `build.js`).

**Alternatives considered**:
- *Layered split (ui/, domain/, gpu/)*: rejected — agents still need to open files from every layer for one feature.
- *Single-file-per-feature*: rejected — `supports` and `viewer` are too large to remain single files.

### 2. Event-bus + observable store as the only cross-feature contract

A 50-line `event-bus.js` (pub/sub) and a small `store.js` (immutable snapshots, subscribe by selector) replace cross-imports of state. Features expose:

- pure functions (e.g. `generateSupports(geometry, opts)`),
- a `mount(rootEl, ctx)` for their panel, where `ctx` exposes `bus`, `store`, `viewer`.

**Why**: removes the implicit coupling that forces `main.js` to know every other module's internals. Makes each capability spec testable in isolation.

**Alternatives considered**:
- *Reactive framework (Svelte/Lit)*: bigger blast radius, violates "keep stack stable".
- *DOM custom events*: harder to type and trace.

### 3. Viewer service as the only THREE entry point

All Three.js construction (scene, camera, renderer, gizmos, BVH meshes, resin shader) is encapsulated in `core/viewer-service.js`. Features get a typed handle (`viewer.addModel(geometry)`, `viewer.setLayerImage(image)`), never `THREE.Scene` directly.

**Why**: shrinks the per-feature surface and keeps GPU details (stencil pipeline, buffer reuse) in one place. `viewer.js` (2,084 LOC) splits into `viewer-service.js` + `gizmos.js` + `materials/resin.js` + `picking.js`.

### 4. Workflow-staged UI shell

Replace the flat sidebar with five ordered stages plus a context inspector:

```diagram
╭─────────────────────────────────────────────────────────────╮
│  [1 Prepare] [2 Orient] [3 Support] [4 Slice] [5 Export]    │  stage tabs
├──────────────────────────────┬──────────────────────────────┤
│                              │  Stage panel (active stage   │
│        3D viewport           │  controls only)              │
│                              ├──────────────────────────────┤
│                              │  Inspector (selection /      │
│                              │  health / layer detail)      │
╰──────────────────────────────┴──────────────────────────────╯
```

Material picker and printer profile become dialogs invoked from the relevant stages, not always-visible panels. Mesh health surfaces inline as a badge on the model in Prepare and opens an inspector when clicked.

**Why**: reduces visual density, maps to the actual user workflow, prevents the "every option visible at once" problem.

**Alternatives considered**:
- *Tabbed sidebar inside one panel*: keeps clutter, doesn't constrain order.
- *Wizard with forced linear progression*: too rigid for power users — stages are jumpable, just ordered.

### 5. Optional JSDoc + `tsc --checkJs` instead of TS migration

Add JSDoc typedefs for the bus events, store shape, and capability public APIs. Wire `tsc --checkJs --noEmit` in CI.

**Why**: gives spec-to-code traceability and IDE help without a full TypeScript port (which would be its own project). Keeps the runtime build trivially Vite.

### 6. Vitest for capability-level tests

Each capability spec scenario maps to a Vitest case. GPU/render code uses headless mocks of the viewer service.

**Why**: scenarios in `openspec/specs/**/*.md` become executable, catching regressions during the rewrite.

## Risks / Trade-offs

- **Risk: Hidden coupling discovered during split** → Mitigation: migrate one capability at a time behind the new event bus, keep a temporary `legacy/` shim importable from `main.js` until all features are ported; CI fails if any source file exceeds 600 LOC.
- **Risk: GPU slicing regressions when moving renderer ownership** → Mitigation: lock the existing slice output for a fixture STL (golden PNG zip) and assert per-layer pixel count matches in tests before/after the move.
- **Risk: UX regression from re-staging the sidebar** → Mitigation: keep an "All tools" mode behind a setting during the migration; gather feedback before removing the old layout.
- **Risk: Auto-orientation worker path breaks under the new module layout** → Mitigation: use Vite's `new Worker(new URL(...), { type: 'module' })` pattern; covered by an integration test that runs the worker in `happy-dom`.
- **Trade-off: More files, more navigation** → Accepted: small files are the explicit goal; an `openspec/specs/` index doubles as the file map.
- **Trade-off: Event bus indirection adds a hop** → Accepted: bus is in-process and synchronous-by-default; perf cost is negligible relative to GPU work.

## Migration Plan

1. **Land specs first** (this change): merge `openspec/specs/**` so future PRs validate against them.
2. **Introduce `core/`** (`event-bus`, `store`, `viewer-service`) without touching feature code; `main.js` adopts them incrementally.
3. **Port leaf capabilities first**: `material-and-printer-profiles`, `multi-plate-project`, `model-io`, `layer-preview`. Each PR moves one folder, deletes the corresponding code from `main.js`, and adds Vitest scenarios.
4. **Port heavy capabilities**: `mesh-health` (split `inspector.js` + `repairer.js`), `support-generation` (split `supports.js` into `detect`/`route`/`build`), `auto-orientation`, `gpu-slicing`, `scene-viewer`.
5. **Replace the shell** (`app-shell`): rebuild `index.html` panel structure into workflow stages once all features are bus-driven.
6. **Delete `main.js` legacy state**, leaving only the bootstrap.
7. **Add LOC guard** in CI (e.g. `wc -l` check) to prevent regression.

Rollback: each step is an independent PR; reverting a step restores the previous capability without affecting unmigrated ones because the event bus accepts the legacy code path during transition.

## Open Questions

- Do we want to add a small typed-action layer (Redux-style reducers) on top of the store, or keep it as freeform setters? Default: freeform setters until pain shows up.
- Should the inspector pane be a separate column on wide screens and an overlay on narrow ones, or always overlay? Defer to UI prototype.
- Is there appetite to add a Web Component boundary per panel? Out of scope for this change; revisit after the split lands.
