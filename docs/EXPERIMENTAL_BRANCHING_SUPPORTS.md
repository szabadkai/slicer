# Experimental Branching Supports

This document tracks the current state of SliceLab's experimental branching
support work.

## Current user workflows

### Auto branching

1. Open the Supports panel.
2. Expand Advanced.
3. In the Branching section, enable Experimental Branching.
4. Set Cluster Radius and Max Tips per Branch if needed.
5. Run Auto-Generate.

The generator first creates normal collision-routed support pillars. It then
clusters nearby non-bridge pillars into graph-based branching structures. Any
pillar that cannot be safely clustered stays linear.

### Manual branch placement

1. Select one model.
2. Open Supports.
3. Under Manual Placement, click Branch Points.
4. Click at least two model surface points.
5. Click Create Branch.

This creates a graph support with multiple tips, one junction, and one base.

### Branch edit gizmo

Click a generated or manual branch support while the Supports panel is active.
The floating gizmo edits graph radii:

- Tip
- Branch
- Trunk
- Base

Clicking a visible tip handle focuses one touchpoint. In that state, the gizmo
also edits touchpoint-level settings:

- Shape: point, ball, cone, or pad
- Load: light, normal, or heavy
- Enabled: disabled touchpoints remain editable as handles but no longer emit
  their tip branch geometry

Changes rebuild the support mesh immediately and autosave the project.

## Architecture added so far

- `SupportStructure`: graph support data model with touchpoints, nodes, and edges.
- `supportStructures` on `ModelPillarSet`: graph supports coexist with legacy linear pillars.
- `buildSupportGraphGeometry`: renders graph edges as tubes and nodes as spheres.
- Save/restore support for graph structures.
- Graph hit testing for selecting branch structures.
- Radius update helpers for gizmo edits.
- Per-touchpoint metadata edits for selected tip handles.

## Safety behavior

Auto branching is conservative:

- Existing pillar routes are planned first.
- Candidate branch graph edges are collision-checked against the model.
- Edges connected to support tips are checked after a short trim from the contact point so the supported surface itself does not reject the branch.
- If any branch edge collides, that candidate cluster falls back to the original linear pillars.

## Known limitations

- Branching is still a topology post-process, not full organic routing.
- Failed branch edges do not yet try alternate junction positions.
- Touchpoint shape and load are stored and editable, but shape-specific contact
  geometry is not rendered yet.
- The edit gizmo changes radii and touchpoint metadata; it does not move
  touchpoints or junctions.
- Selected graph handles are visual anchors first, not draggable handles yet.
- Manual branch placement does not collision-route the generated graph.

## Near-term roadmap

1. Render visible handles for selected branch tips, junctions, and bases.
2. Let the gizmo select and edit individual handles.
3. Render shape-specific touchpoint contact geometry.
4. Add per-touchpoint delete and restore controls.
5. Add draggable touchpoints constrained to the model surface.
6. Add branch validation status in the gizmo.
7. Try alternate junction positions before falling back to linear pillars.
