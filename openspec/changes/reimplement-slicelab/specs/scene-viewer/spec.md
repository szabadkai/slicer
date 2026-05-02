## ADDED Requirements

### Requirement: Render the build volume and models in 3D

The system SHALL render the active plate's build volume (printer-defined width × depth × height), a ground grid, axis indicators, and all loaded models with the currently selected resin material in a perspective WebGL viewport.

#### Scenario: Build volume reflects selected printer
- **WHEN** the user changes the selected printer
- **THEN** the build-volume box is resized to match `buildWidthMM × buildDepthMM × buildHeightMM` of the chosen printer.

#### Scenario: Resin appearance reflects selected material
- **WHEN** the user picks a different resin material
- **THEN** every loaded model is shaded with that material's color, transmission, and roughness.

### Requirement: Camera navigation

The system SHALL provide orbit, pan, and zoom on the viewport, plus one-click "frame model" and axis-aligned views (top, front, side, perspective).

#### Scenario: Orbit with the mouse
- **WHEN** the user left-drags inside the viewport
- **THEN** the camera orbits around the focus point at interactive frame rate.

#### Scenario: Frame the active model
- **WHEN** the user presses the "Frame" shortcut with a model loaded
- **THEN** the camera animates to a view that fits the model's bounding box with margin.

### Requirement: Selection and picking

The system SHALL allow the user to select a model by clicking on it, multi-select with Shift+click, and clear selection by clicking empty space. The active selection is the unit operated on by transform, support generation, repair, and export.

#### Scenario: Click selects a model
- **WHEN** the user clicks a visible model
- **THEN** the model is highlighted with a selection outline and its info appears in the inspector.

#### Scenario: Click empty space clears selection
- **WHEN** the user clicks on empty viewport area
- **THEN** all selection outlines are removed and selection-dependent panels show their empty state.

### Requirement: Single THREE.js entry point

The system SHALL expose a single viewer service module that owns the THREE.js scene, camera, renderer, and BVH-accelerated meshes. No other module SHALL import `three` directly except this service and `gpu-slicing`.

#### Scenario: Capability requests model addition through the service
- **WHEN** the `model-io` capability finishes parsing an STL
- **THEN** it calls `viewer.addModel(geometry, opts)` and never constructs a `THREE.Mesh` itself.
