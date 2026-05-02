# Model Inspector & Repair Tool

## Overview

A comprehensive pre-slice inspection and repair tool that analyzes loaded 3D models for common issues that cause failed prints, printing artifacts, or sub-optimal results. The tool provides actionable diagnostics, visual highlighting, and automated repair capabilities.

## Goals

1. **Prevent failed prints** by catching geometry issues before slicing
2. **Improve print quality** by identifying and repairing problematic areas
3. **Reduce support material** by detecting thin walls and optimizing orientation
4. **Provide actionable feedback** with clear explanations and repair options

---

## Phase 1: Inspection Engine

### Core Analysis Module (`inspector.js`)

```javascript
// Proposed structure
class ModelInspector {
  constructor(geometry, options = {}) {}
  
  // Detection methods (each returns array of issues)
  detectNonManifoldEdges()    // Edges with != 2 adjacent faces
  detectOpenBoundaries()       // Boundary edges (holes in mesh)
  detectInvertedNormals()      // Faces with incorrect winding
  detectDuplicateVertices()     // Vertices at same position
  detectDegenerateTriangles()  // Zero-area triangles
  detectSelfIntersections()     // Faces intersecting each other
  detectThinFeatures()         // Walls thinner than printer resolution
  detectSmallComponents()       // Floating debris, disconnected geometry
  detectScaleIssues()           // Model too small/large for build plate
  detectSharpOverhangs()        // Angles requiring support
  
  // Combined analysis
  runFullInspection()          // Returns comprehensive report
  
  // Utilities
  getIssueLocations(issue)      // Returns vertex positions for highlighting
  countIssueOccurrences(issue)  // Statistical summary
}
```

### Issue Types & Severity

| Issue | Severity | Impact | Fixable |
|-------|----------|--------|---------|
| Non-manifold edges | ERROR | Slice will fail | Manual cleanup needed |
| Open boundaries (holes) | ERROR | Causes holes in sliced layers | Auto-fill possible |
| Inverted normals | WARNING | Incorrect inside/outside detection | Auto-fix |
| Duplicate vertices | WARNING | Wastes memory, causes artifacts | Auto-fix (merge) |
| Degenerate triangles | WARNING | Zero-area, can cause issues | Auto-fix (remove) |
| Self-intersections | ERROR | Causes unpredictable slicing | Manual cleanup needed |
| Thin features | INFO | May not print well | Warning + auto-orient |
| Small components | INFO | Often printing artifacts | Auto-remove option |
| Scale issues | INFO | May not fit on plate | Warning |
| Sharp overhangs | INFO | Requires supports | Auto-support suggestion |

### Report Structure

```typescript
interface InspectionReport {
  timestamp: Date;
  geometry: {
    triangleCount: number;
    vertexCount: number;
    boundingBox: Box3;
    volume: number;
  };
  issues: Issue[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
  overallHealth: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  printerSpecificIssues?: ThinFeatureIssue[];
}

interface Issue {
  id: string;
  type: string;
  severity: 'error' | 'warning' | 'info';
  count: number;
  description: string;
  impact: string;
  repairSuggestion?: string;
  locations?: Float32Array;  // Vertex positions for visualization
}
```

---

## Phase 2: Visual Highlighting

### Integration with Viewer

```javascript
// New Viewer methods
class Viewer {
  highlightIssues(issues, options = {}) {
    // options: { color, opacity, showLabels }
    // Returns visualization meshes
  }
  
  clearIssueHighlights() {
    // Cleanup highlighted geometry
  }
  
  showIssueDetails(issue) {
    // UI panel with detailed info
  }
}
```

### Visualization Options

1. **Color-coded by severity**
   - Errors: Red (#ff4444)
   - Warnings: Orange (#ff9944)
   - Info: Yellow (#ffdd44)

2. **Highlighting modes**
   - Points: Show problematic vertices
   - Edges: Highlight non-manifold/boundary edges
   - Faces: Highlight problem triangles
   - Combined: Mixed visualization

3. **Interactive features**
   - Click to zoom to issue
   - Filter by issue type
   - Toggle highlight visibility

---

## Phase 3: Repair Capabilities

### Automated Repairs

```javascript
class ModelRepairer {
  constructor(geometry) {}
  
  // High-confidence repairs
  fixDuplicateVertices(options = {})       // Merge vertices within tolerance
  fixDegenerateTriangles(options = {})     // Remove zero-area triangles
  fixInvertedNormals(options = {})         // Flip to match majority
  weldBoundaryEdges(options = {})          // Close small holes
  
  // Interactive repairs
  fillHole(faceId, targetSize)             // User selects hole to fill
  removeSmallComponents(sizeThreshold)      // Remove floating debris
  mergeNearbyVertices(tolerance)            // Smart vertex welding
  
  // Export repaired geometry
  getRepairedGeometry()                    // Returns fixed BufferGeometry
}
```

### Repair Options

| Repair | Tolerance | Risk | Use Case |
|--------|-----------|------|----------|
| Weld vertices | 0.001-0.1mm | Low | STL imports with duplicates |
| Remove degenerates | N/A | Low | Cleanup bad triangles |
| Flip normals | N/A | Medium | When majority is correct |
| Fill small holes | <5mm diameter | Medium | Auto-close trivial holes |
| Remove small parts | configurable | High | User must approve |

---

## Phase 4: UI Integration

### New Panel: "Model Health"

Add to the sidebar between "Materials" and "Slice" panels.

```
┌─────────────────────────────────────┐
│  MODEL HEALTH          [Analyze]   │
├─────────────────────────────────────┤
│  ┌─────────────────────────────────┐│
│  │         Health Score            ││
│  │            87%                 ││
│  │         ████████░░              ││
│  └─────────────────────────────────┘│
│                                     │
│  Issues Found:                       │
│  ┌─────────────────────────────────┐│
│  │ ⚠ 3 warnings (orange)           ││
│  │   • 24 duplicate vertices       ││
│  │   • 2 inverted normals         ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ ℹ 2 info (yellow)              ││
│  │   • Thin wall detected (0.2mm) ││
│  │   • Small component (2 tris)   ││
│  └─────────────────────────────────┘│
│                                     │
│  [⚡ Auto-Repair]  [📍 Show Issues]  │
│                                     │
│  ┌─────────────────────────────────┐│
│  │ Printer Compatibility:          ││
│  │   218.88 × 122.88 × 200mm       ││
│  │   Min pixel: 18.24 µm           ││
│  │   ⚠ Thin wall (18µm) may not   ││
│  │     show on Saturn 2            ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

### UI Elements

1. **Health score gauge** - Visual 0-100% indicator
2. **Issue list** - Expandable sections by severity
3. **Quick actions** - One-click auto-repair buttons
4. **Detailed view** - Click issue for 3D visualization
5. **Printer context** - Issues relevant to selected printer

---

## Phase 5: Integration with Existing Workflow

### Flow Diagram

```
┌──────────────────┐
│  Load STL File   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Model Inspector  │◄──── Optional re-run
│  (Auto-run)      │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Show Results +   │
│ Health Panel     │
└────────┬─────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌───────┐  ┌────────┐
│ Fix   │  │ Proceed│
│ Issues│  │ Anyway│
└───┬───┘  └───┬────┘
    │          │
    ▼          ▼
┌──────────────────┐
│  Auto-Orient     │
│  (considers     │
│  thin walls)    │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Generate Supports│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│     Slice        │
└──────────────────┘
```

### Integration Points

1. **Auto-trigger**: Run inspection on model load
2. **Pre-slice check**: Validate before slicing
3. **Orientation consideration**: Factor thin walls into auto-orient
4. **Support generation**: Adjust support strategy based on findings
5. **Layer inspector**: Link issues to sliced layer problems

---

## Technical Implementation Notes

### Performance Considerations

1. **Web Worker**: Run analysis off main thread for large models
2. **Progressive analysis**: Show results as issues are found
3. **LOD visualization**: Don't render all point/edge markers for huge issues
4. **Caching**: Cache inspection results, invalidate on geometry change

### Algorithms

1. **Non-manifold detection**: Build edge-faces adjacency map, find edges with != 2 faces
2. **Boundary detection**: Find connected edge loops that aren't in closed faces
3. **Duplicate vertices**: Spatial hash with configurable tolerance
4. **Self-intersection**: Use BVH for O(n log n) face pair testing (expensive, optional)
5. **Thin feature detection**: Sample cross-sections, measure wall thickness
6. **Volume computation**: Reuse existing `computeMeshVolume()` for watertight check

### Data Structures

```javascript
// Edge map for non-manifold detection
Map<edgeKey, { faces: [faceId, faceId, ...], boundary: boolean }>

// Vertex welding spatial hash
Map<voxelKey, [vertexIndex, ...]>

// Boundary edge tracking
Set<boundaryEdgeKey>  // For hole filling
```

---

## File Structure

```
src/
├── inspector.js          # Main inspection class
├── inspector.worker.js   # Web Worker for analysis
├── repairer.js           # Repair operations
├── inspector-ui.js      # UI panel component
└── main.js               # Integration hooks
```

---

## Deliverables

1. **inspector.js** - Core inspection engine
2. **repairer.js** - Automated repair functions
3. **UI panel** - Model Health sidebar panel
4. **Integration** - Hook into model load & pre-slice workflow
5. **Visual highlights** - 3D visualization of issues

---

## Future Enhancements

1. **Hole-filling wizard**: Guide user through filling complex holes
2. **Boolean operations**: Help merge overlapping shells
3. **Lattice detection**: Identify thin support structures
4. **Printability prediction**: ML-based print success estimation
5. **Cloud repair integration**: Offer server-side repair for complex cases
