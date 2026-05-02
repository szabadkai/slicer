## ADDED Requirements

### Requirement: Translate, rotate, and scale via gizmos

The system SHALL display a transform gizmo on the active selection that supports three modes — Translate, Rotate, Scale — toggled by the `W`, `E`, `R` shortcuts. Dragging the gizmo SHALL update the model's transform live in the viewport.

#### Scenario: Translate a model along X
- **WHEN** the user drags the X handle of the translate gizmo by 10 mm
- **THEN** the model's world position increases by 10 mm on X and the bounding box readout updates.

#### Scenario: Switch gizmo modes via shortcut
- **WHEN** the user presses `R` while a model is selected
- **THEN** the gizmo switches to scale mode without losing selection or transform.

### Requirement: Numeric transform input

The system SHALL provide numeric inputs for position (X/Y/Z mm), rotation (X/Y/Z degrees), and scale (uniform and per-axis). Editing a value SHALL apply the same transform that the gizmo would.

#### Scenario: Set rotation Z to 90°
- **WHEN** the user types `90` in the rotation Z input
- **THEN** the model rotates to 90° on Z and the gizmo orientation matches.

#### Scenario: Uniform scale toggle
- **WHEN** uniform scale is enabled and the user changes the X scale
- **THEN** Y and Z scale values follow the same factor.

### Requirement: Drop to plate

The system SHALL provide a "Drop to plate" action that translates the selection so that its lowest point on the build axis sits at Z = 0 with no other axis change.

#### Scenario: Drop a floating model
- **WHEN** a model with min-Z = 12 mm is selected and the user clicks "Drop to plate"
- **THEN** the model's min-Z becomes 0 mm and X/Y position is unchanged.

### Requirement: Undo and redo of transforms

The system SHALL maintain at least 20 steps of undo/redo for transform changes, with `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z` shortcuts.

#### Scenario: Undo a translate
- **WHEN** the user translates a model and then presses `Ctrl/Cmd+Z`
- **THEN** the model returns to its previous position.
