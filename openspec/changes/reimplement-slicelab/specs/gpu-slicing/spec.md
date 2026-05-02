## ADDED Requirements

### Requirement: GPU stencil-buffer slicing pipeline

The system SHALL slice the active plate's combined geometry (models + supports) into per-layer monochrome bitmaps using a WebGL stencil-buffer based pipeline (front-face increment / back-face decrement / fullscreen mask), at the printer's screen resolution.

#### Scenario: Layer count matches printer resolution and layer height
- **WHEN** the user slices a 20 mm tall model at 0.05 mm layer height
- **THEN** the result contains 400 layers, each at the printer's resolution X × Y in pixels.

#### Scenario: Slice represents inside-of-mesh as white
- **WHEN** the user slices a 10 mm cube
- **THEN** every interior layer's white-pixel area equals the cube cross-section to within 1% of expected pixels.

### Requirement: Slicing parameters

The system SHALL expose user-editable slicing parameters: layer height (mm), normal exposure (s), bottom layer count, bottom exposure (s), lift height (mm), lift speed (mm/min). Parameters SHALL persist per project.

#### Scenario: Parameters persist after reload
- **WHEN** the user sets layer height to 0.03 mm, reloads the page, and restores the project
- **THEN** the layer height input shows 0.03 mm.

### Requirement: Cancellable, per-plate slicing with cache

The system SHALL allow the user to slice the active plate, slice all plates in sequence, or cancel an in-progress slice. Successful results SHALL be cached per plate and invalidated when geometry, supports, printer, or slicing parameters change for that plate.

#### Scenario: Switching plates does not re-slice
- **WHEN** the user slices plate 1, switches to plate 2 (already sliced), and switches back to plate 1
- **THEN** plate 1's cached layers are shown immediately without re-running the slicer.

#### Scenario: Cache invalidates after a transform
- **WHEN** the user moves a model on a previously sliced plate
- **THEN** the cache is dropped and the slice button re-enables for that plate.

#### Scenario: Cancel mid-slice
- **WHEN** the user clicks "Cancel" while slicing
- **THEN** rendering stops within one layer, partial results are discarded, and the UI returns to the pre-slice state.

### Requirement: Print time estimation

The system SHALL estimate total print time from layer count, normal/bottom exposure, lift height, and lift speed, and display it alongside the slicing controls.

#### Scenario: Estimate updates with parameters
- **WHEN** the user doubles the normal exposure
- **THEN** the displayed estimate increases by approximately the per-layer exposure delta times the non-bottom layer count.
