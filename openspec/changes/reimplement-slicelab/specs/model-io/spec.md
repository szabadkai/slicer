## ADDED Requirements

### Requirement: Load STL files from disk

The system SHALL accept binary and ASCII STL files via either a file picker or drag-and-drop onto the viewport, parse them into an indexed `THREE.BufferGeometry` with computed vertex normals, and add the resulting model to the active build plate.

#### Scenario: User loads a binary STL via file picker
- **WHEN** the user selects a `.stl` file in the file input
- **THEN** the system parses it, centers it on the build plate, computes a BVH, and shows it in the viewport with a non-empty model summary (triangle count, bounding box).

#### Scenario: User drops multiple STL files on the viewport
- **WHEN** the user drops two `.stl` files on the viewport at once
- **THEN** both files are loaded as separate models on the active plate, both selectable independently.

#### Scenario: User loads a malformed file
- **WHEN** the user selects a non-STL or truncated file
- **THEN** the system shows a non-blocking error toast describing the failure and the viewport state is unchanged.

### Requirement: Project autosave and restore

The system SHALL persist the current project (plates, models, transforms, material/printer selections, support settings, slicing settings) to browser local storage at most once per second after any user-driven mutation, and offer to restore it on the next session.

#### Scenario: Autosave after a transform
- **WHEN** the user moves a model and then waits one second
- **THEN** an autosave entry exists in local storage that includes the new transform.

#### Scenario: Restore prompt on next visit
- **WHEN** the user reloads the page and an autosave exists
- **THEN** a restore dialog offers "Restore", "Discard", or "Skip"; choosing "Restore" rebuilds the prior project state without requiring re-import of source files.

#### Scenario: Discard autosave
- **WHEN** the user clicks "Discard" in the restore dialog
- **THEN** the autosave entry is removed and the app starts with an empty project.

### Requirement: Export models and slices

The system SHALL export the active plate as STL, OBJ, or 3MF, and the sliced layers as a ZIP of PNG images plus a JSON metadata manifest.

#### Scenario: Export STL
- **WHEN** the user picks "Export → STL" with at least one model on the plate
- **THEN** a `.stl` file containing all plate models (with current transforms and any generated supports) is downloaded.

#### Scenario: Export sliced PNG zip
- **WHEN** the user picks "Export → Slices" after a successful slice
- **THEN** a `.zip` is downloaded containing one PNG per layer named `slice_<index>.png`, plus a `manifest.json` describing printer, resin, layer height, exposure times, and per-layer pixel volume.

#### Scenario: Export disabled when nothing to export
- **WHEN** there are no models on the active plate
- **THEN** export controls are disabled with a tooltip explaining why.
