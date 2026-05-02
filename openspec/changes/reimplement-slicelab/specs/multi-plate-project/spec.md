## ADDED Requirements

### Requirement: Manage multiple build plates in one project

The system SHALL allow the user to add, remove, rename, and switch between multiple build plates within a single project. Each plate SHALL hold its own models, transforms, supports, material, slicing parameters, and slice cache.

#### Scenario: Add a plate
- **WHEN** the user clicks "Add plate" with one plate present
- **THEN** a new empty plate (default name "Plate 2") appears in the tab bar and becomes active.

#### Scenario: Switching plates preserves state
- **WHEN** the user has plates A and B with different models, switches to B, then back to A
- **THEN** plate A's models, transforms, and selection are restored exactly.

#### Scenario: Remove a plate with confirmation
- **WHEN** the user removes a plate that contains models
- **THEN** a confirmation dialog appears; on confirm the plate and its slice cache are deleted, and another plate becomes active.

### Requirement: Auto-rename default plates

The system SHALL keep default-named plates ("Plate N") sequentially numbered when plates are added or removed, without renaming user-edited plate names.

#### Scenario: Renumber after delete
- **WHEN** plates "Plate 1", "Plate 2", "Plate 3" exist and the user deletes "Plate 2"
- **THEN** the remaining plates become "Plate 1" and "Plate 2".

#### Scenario: Custom names are preserved
- **WHEN** plates "Bases", "Plate 2" exist and the user deletes "Plate 2"
- **THEN** the remaining plate's name is still "Bases".

### Requirement: Arrange / pack models on a plate

The system SHALL provide an "Arrange" action that lays out all models on the active plate within the printer's build area without overlap, prioritizing minimum bounding-area packing.

#### Scenario: Arrange spreads overlapping models
- **WHEN** the user clicks "Arrange" with three overlapping models on a plate that fits them
- **THEN** every pair of models has non-overlapping XY bounding boxes after arrangement.

#### Scenario: Arrange reports infeasible layout
- **WHEN** the total model footprint exceeds the build area
- **THEN** the system shows a warning that not all models fit and leaves the unfittable models flagged.
