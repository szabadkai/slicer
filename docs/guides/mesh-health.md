# Mesh Health

Before slicing, SliceLab can analyse your model for geometry issues that may cause failed or artefact-ridden prints. Open the **Inspect** panel and click **Analyze** to run a full health check.

## Health score

The health score (0–100) is a weighted aggregate of all detected issues. 100 means no problems found. The arc gauge colour-codes the result:

- **Green (80–100)** — model is ready to slice
- **Yellow (50–79)** — minor issues; may print fine but review the issue list
- **Red (0–49)** — significant issues; fix before slicing

## Issue categories

### Non-manifold edges

An edge is **non-manifold** if it's shared by more than two faces (or by exactly one face — an open boundary). A valid, printable mesh is a closed 2-manifold — every edge is shared by exactly two faces, and the mesh has no holes.

Non-manifold edges typically come from:
- Boolean operations that didn't quite close
- Imported CAD files with surface patches that don't share topology
- Meshes built from separate, non-welded pieces

**Impact:** Slicers interpret the solid by ray-casting into the mesh. Non-manifold edges confuse the inside/outside test, producing incorrect cross-sections (missing areas, extra fills).

**Fix:** Auto-repair attempts to weld coincident edges. For complex non-manifold geometry, repair in a dedicated mesh-repair tool (Meshmixer, Blender) before importing.

### Inverted normals

Every face has a **normal** — a vector pointing outward from the solid's surface. If a face's normal points inward, the slicer thinks that face is a wall of a void rather than a wall of the solid.

**Impact:** Inverted faces can cause the slicer to treat parts of the model as holes, resulting in layers with unexpected voids.

**Fix:** Auto-repair detects and flips inverted normals. This is reliable when the mesh is otherwise well-formed.

### Degenerate triangles

A **degenerate triangle** has zero area — the three vertices are collinear or coincident. These often appear after boolean operations or mesh simplification.

**Impact:** Degenerate triangles don't contribute to the mesh volume but can confuse intersection algorithms and produce artefacts in the slice images.

**Fix:** Auto-repair removes degenerate triangles safely.

### Duplicate vertices

Two or more vertices at the exact same position that are not connected in the mesh topology. Common when models are assembled from separate parts without welding.

**Impact:** Duplicate vertices don't directly cause print failures but are a sign of a non-welded mesh, which may have non-manifold edges.

**Fix:** Auto-repair merges vertices within a configurable distance threshold.

### Thin walls

Walls thinner than a configurable threshold (default: 0.5 mm) may not cure properly or may break during washing and support removal.

**Impact:** Very thin sections may print as blobs (over-exposed to compensate) or not at all.

**Fix:** Repair in CAD — mesh-based repair of thin walls is not reliable. If the thin section is intentional (e.g., a membrane), ensure your resin and settings are appropriate.

## What auto-repair fixes

| Issue | Auto-repair? |
|---|---|
| Non-manifold edges | Partial — simple cases only |
| Inverted normals | Yes — reliable |
| Degenerate triangles | Yes — reliable |
| Duplicate vertices | Yes — reliable |
| Thin walls | No — requires CAD changes |
| Self-intersections | No — requires CAD changes |

## Heatmaps

**Wall thickness heatmap** — colours the model surface by local wall thickness. Red = thin, blue = thick. Use this to spot regions that may be fragile before printing.

**Support stress heatmap** — highlights areas of the model surface where supports are attached. Use this to understand which surfaces will have support removal marks.

Toggle heatmaps with the buttons in the Inspect panel header. Heatmaps are visualisation-only and don't affect slicing.

## Tips

- Run Analyze on every imported model before slicing — even "clean" exports from CAD tools often have minor issues
- Auto-repair is non-destructive in intent but does modify the mesh; use Undo if the result looks wrong
- Non-manifold issues that auto-repair can't fix usually require the original CAD model to be corrected at source
