## ADDED Requirements

### Requirement: Scrub through sliced layers

The system SHALL display a slider and a 2D canvas in the slicing panel that lets the user step through any sliced layer of the active plate. The current layer index, height (mm), and white-pixel count SHALL be shown alongside the canvas.

#### Scenario: Slider reflects layer count
- **WHEN** the active plate has 400 sliced layers
- **THEN** the slider's range is 0–399 and dragging to the end shows the topmost layer.

#### Scenario: Layer info updates while scrubbing
- **WHEN** the user drags the slider to layer 100 at 0.05 mm layer height
- **THEN** the panel displays "Layer 100 / 400 — Z 5.00 mm" and a non-zero pixel count.

### Requirement: Fullscreen layer inspector

The system SHALL provide a fullscreen layer inspector modal that shows the current layer at native printer resolution (with pan/zoom), reachable from an "Expand" control next to the layer canvas.

#### Scenario: Open inspector
- **WHEN** the user clicks "Expand" with sliced layers available
- **THEN** the inspector opens with the same current layer index pre-selected and supports keyboard arrow navigation between layers.

#### Scenario: Pan and zoom in inspector
- **WHEN** the user scrolls inside the inspector canvas
- **THEN** the layer image zooms toward the cursor without resampling artifacts.

### Requirement: Pixel-volume readback

The system SHALL compute the cured-resin volume by summing white pixels across all layers, multiplying by pixel area and layer height, and SHALL distinguish model and support contributions when supports were rendered into separate stencil passes.

#### Scenario: Pixel volume reported after slice
- **WHEN** slicing finishes
- **THEN** the summary shows total volume in mL, with a breakdown of model vs support volume when available.

#### Scenario: Pre-slice estimate is mesh-based
- **WHEN** no slice exists yet
- **THEN** the summary shows a mesh-based volume estimate marked as "estimate".
