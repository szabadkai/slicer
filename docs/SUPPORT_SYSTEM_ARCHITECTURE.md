# Support System Architecture

This document describes the internal architecture of SliceLab's support generation system. It is intended for developers and AI agents working on the codebase.

## Data flow overview

```
Contact detection         Route planning           Pillar store             Visible mesh
   (supports.ts)     -->    (supports.ts)     -->  (pillar-store.ts)  -->  (viewer-supports.ts)
                                                         ^
Manual placement  ------------------------------------|  |
  (manual-pillar.ts)                                     |
                                                         v
Right-click delete  <--  panel.ts  <--  viewer-core-selection.ts (raycast)
```

### The pillar store is the source of truth

`src/features/support-generation/pillar-store.ts` holds a module-level `Map<string, ModelPillarSet>` keyed by `SceneObject.id`. Every support operation mutates this store, then calls `rebuildSupportsMesh` to regenerate the visible `THREE.BufferGeometry`.

**Never** manipulate `SceneObject.supportsMesh` directly. Always go through the store.

## File map

| File | Role |
|---|---|
| `src/supports.ts` | Orchestrates auto-generation: overhang detection, contact sampling, route planning. Returns `Pillar[]` + settings. |
| `src/supports-geometry.ts` | Geometry building (`buildSupportGeometry`), collision detection (`segmentCollides`, `routeCollides`), cross-bracing, merging. |
| `src/supports-base-pan.ts` | Base pan geometry + convex hull (extracted from supports-geometry.ts). |
| `src/supports-utils.ts` | Pure math helpers: Halton sequences, deduplication, direction offsets. |
| `src/features/support-generation/pillar-store.ts` | **Source of truth.** Pillar records, CRUD operations, `rebuildSupportsMesh`. |
| `src/features/support-generation/panel.ts` | UI panel: generate/clear buttons, settings inputs, right-click delete handler, overhang overlay. |
| `src/features/support-generation/manual-pillar.ts` | Click-to-place manual pillar: route planning, store insertion, rebuild. |
| `src/features/support-generation/manual-support.ts` | Pointer event handling for manual placement mode (hover preview, click dispatch). |
| `src/features/support-generation/explanation-inspector.ts` | Support-click popup showing why a pillar was placed. |
| `src/features/support-generation/store.ts` | Legacy signal-based store (UI cache layer). May be retired. |
| `src/viewer-supports.ts` | Viewer delegate: `setSupportsMesh`, `clearSupports`, `rebuildSupportsFromStore`, `removePillarAndRebuild`, `findPillarHit`. |
| `src/viewer-undo.ts` | Undo/redo with `pillar-edit` entry type for support operations. |
| `src/viewer-serialize.ts` | Serializes/restores `ModelPillarSet` alongside model data for project persistence. |

## Key types

### Pillar (pillar-store.ts)

```typescript
interface Pillar {
  id: string;
  origin: 'auto' | 'manual';
  route: RouteWaypoint[];    // waypoints from contact point down to base
  tipDiameter: number;
  pillarRadius: number;
  baseRadius: number;
  tipHeight: number;
  baseHeight: number;
  contact: { x: number; y: number; z: number };  // plate-local coords
}
```

### ModelPillarSet (pillar-store.ts)

```typescript
interface ModelPillarSet {
  pillars: Pillar[];
  settings: PillarSetSettings;  // cross-bracing, base-pan, spherical connection, etc.
  legacyOpaque?: boolean;       // true for pre-rework saved projects
}
```

### RouteWaypoint (supports-geometry.ts)

```typescript
interface RouteWaypoint {
  x: number; y: number; z: number;
  internalResting?: boolean;  // pillar rests on model surface instead of build plate
}
```

## How auto-generation works

1. **`generateSupports(geometry, options)`** in `supports.ts`:
   - Computes BVH for the model geometry (fast raycasting)
   - Detects overhang faces below the angle threshold
   - Samples contact points based on density
   - Filters to exterior-only contacts (unless internal supports enabled)
   - For each contact: calls `planSupportRoute` to find a collision-free path
   - Returns `{ pillars: Pillar[], settings: PillarSetSettings }`

2. **`panel.ts: handleGenerate()`**:
   - Dispatches `pillar-edit-undo-save` event (for undo)
   - Calls `replaceAutoPillars(modelId, autoPillars)` — keeps manual, replaces auto
   - Calls `updatePillarSettings(modelId, settings)`
   - Calls `viewer.rebuildSupportsFromStore(modelId)` — rebuilds visible mesh

3. **`rebuildSupportsMesh(modelId)`** in `pillar-store.ts`:
   - Iterates ALL pillars (auto + manual)
   - Calls `buildSupportGeometry` per pillar
   - Applies cross-bracing if enabled (union of all routes)
   - Applies base pan if enabled (union of all routes)
   - Merges into single `THREE.BufferGeometry`

## How manual placement works

1. User clicks model surface in manual placement mode
2. `manual-support.ts` dispatches with world position + normal
3. `manual-pillar.ts: addManualPillar()`:
   - Converts world coords to plate-local coords
   - Plans route via `planSupportRoute` (same as auto-gen)
   - If no valid route: dispatches `manual-support-failed` event and bails
   - Dispatches `pillar-edit-undo-save` event
   - Calls `buildPillarFromRoute` + `addManualPillarRecord`
   - Calls `viewer.rebuildSupportsFromStore`

## How right-click delete works

Only active when the supports tool panel is open.

1. `viewer-core-selection.ts: handleSupportContextMenu` raycasts support meshes
2. If hit: fires `support-right-clicked` CustomEvent with world-space hit point
3. `panel.ts` listener calls `viewer.findPillarHit(point)` to identify the pillar
4. Calls `viewer.removePillarAndRebuild(modelId, pillarId)` which:
   - Dispatches `pillar-edit-undo-save` (for undo)
   - Calls `removePillar` on the store
   - Calls `rebuildSupportsFromStore`

## Collision detection (pierce prevention)

### The collision pipeline

`routeCollides` in `supports-geometry.ts` validates whether a proposed route would pass through the model. For each segment in the route:

1. `segmentCollides(from, to, context, radius)` fires 5 rays (center + 4 cardinal offsets at the pillar radius) from `from` toward `to`
2. `clearanceSampleStarts(origin, axis, radius)` generates the 5 ray origins in a cross pattern at full pillar radius around the segment axis
3. Any hit between the endpoints means the segment collides

### Critical: DoubleSide material

The temporary mesh used for raycasting (`tempMesh` in `supports.ts` and `manual-pillar.ts`) **MUST** use `THREE.MeshBasicMaterial({ side: THREE.DoubleSide })`.

**Why:** The first check in `routeCollides` starts from `tipBottom = contact.y - tipHeight`, which is a point **inside** the model body (below the overhang surface). With `FrontSide` (the THREE.js default), rays from inside the mesh don't detect faces because backfaces are culled. This means the entire collision check is blind from inside the model, and routes going straight through the model body report "no collision."

This was the root cause of the pierce-through bug. If you create a new raycasting mesh for collision detection anywhere, always use `DoubleSide`.

### The tip radius

The first route segment (the tip) uses `Math.max(shaftRadius, tipRadius)` for collision sampling because the tip flares wider than the shaft. `routeCollides` accepts an optional `tipRadius` parameter for this.

## Undo system for supports

Support edits use a lightweight undo entry that only stores the pillar data (not the full mesh geometry):

```typescript
interface PillarEditEntry {
  type: 'pillar-edit';
  modelId: string;
  previousPillarSet: ModelPillarSet;
}
```

**How to add undo to a new support operation:**
1. Before mutating the pillar store, dispatch: `document.dispatchEvent(new CustomEvent('pillar-edit-undo-save', { detail: { modelId } }))`
2. The viewer's constructor wires a listener that calls `savePillarEditUndoState(viewer, modelId)`
3. This snapshots the current `ModelPillarSet` (deep clone) and pushes it onto `viewer.undoStack`

The `undo()` and `redo()` functions in `viewer-undo.ts` check for `type === 'pillar-edit'` before the `multi-plate` and default branches. Restoring calls `setPillarSet` + `rebuildSupportsFromStore`.

## Serialization

`SerializedPillarSet` in `project-store.ts` is the on-disk format. It strips non-serializable fields (`routeContext` which contains THREE.js objects).

**Save:** `serializeObjects` in `viewer-serialize.ts` serializes pillar data. For rework-era projects, the legacy `supports` mesh field is set to `null` (redundant with per-pillar data). For legacy-opaque projects (no per-pillar data), `supports` mesh is still serialized.

**Restore:** If `pillarSet` is present in saved data, restore per-pillar data and rebuild the mesh via `queueMicrotask` (deferred because `findObjectAnywhere` needs the object to be in a plate first). If only `supports` is present (pre-rework project), restore the opaque mesh and mark `legacyOpaque: true`. The first manual-add or auto-regen wipes the legacy mesh.

## Settings that apply to all pillars

These settings in `PillarSetSettings` apply across the entire union of auto + manual pillars:

| Setting | Effect |
|---|---|
| `crossBracing` | Diagonal struts between adjacent pillar routes |
| `basePan` | Flat pad geometry at the base of the support cluster |
| `sphericalConnection` | Ball joint at the contact point (configurable radius) |
| `supportFloorY` | Y coordinate of the build plate (usually 0, offset when base pan is enabled) |

All are applied during `rebuildSupportsMesh`, not during route planning.

## Testing

- `pillar-store.test.ts` — store CRUD, `findPillarNear`, vertex count growth
- `supports-geometry.test.ts` — pierce-regression test (offset sample catches geometry that center ray misses)
- `support-generation.test.ts` — overhang detection, contact sampling
- `store.test.ts` — legacy signal store

When writing new tests that use the pillar store, call `_resetPillarStoreForTests()` in `beforeEach` to clear the module-level map.
