## ADDED Requirements

### Requirement: Detect overhangs above a configurable angle

The system SHALL detect overhang faces on the active model whose downward-facing normal exceeds a configurable angle threshold (default 30°, range 10°–80°) relative to the build axis, and visualize them in the viewport.

#### Scenario: Default angle highlights underside
- **WHEN** the user opens the supports panel on a sphere
- **THEN** the lower hemisphere is highlighted as overhang at the default 30° threshold.

#### Scenario: Raising the threshold removes near-vertical faces
- **WHEN** the user changes the overhang angle from 30° to 60°
- **THEN** previously highlighted near-vertical faces stop being highlighted.

### Requirement: Generate support pillars with tip / shaft / base anatomy

The system SHALL generate support geometry composed of: a tapered tip touching the model, a vertical shaft, optional angled branches, and a wide cone or pad on the build plate. Tip diameter, shaft thickness, base diameter, and density SHALL be user-configurable, with `auto` modes for density and thickness.

#### Scenario: Auto density places more supports on larger overhangs
- **WHEN** the user enables auto density and generates supports on two overhang patches of different size
- **THEN** the larger patch receives at least proportionally more contact points than the smaller one.

#### Scenario: Tip diameter setting reaches geometry
- **WHEN** the user sets tip diameter to 0.4 mm and generates supports
- **THEN** every generated tip's contact circle has diameter within ±0.05 mm of 0.4 mm.

### Requirement: Route supports around obstructions

The system SHALL plan each support's path from the contact point to the plate, preferring a short angled branch into a vertical shaft when the direct vertical path is blocked by other model geometry, and SHALL skip contact points it cannot route within configured constraints.

#### Scenario: Angled branch around an obstruction
- **WHEN** an overhang sits above a wider feature of the same model
- **THEN** the support uses an angled segment to route around the wider feature instead of intersecting it.

#### Scenario: Unrouteable contacts are reported
- **WHEN** a contact point cannot be routed within `maxContactOffset`
- **THEN** the system logs a warning count in the supports panel and skips that contact.

### Requirement: Optional cross-bracing and base pan

The system SHALL allow the user to enable cross-bracing between adjacent vertical shafts and a base pan (a thin plate on the build plate with a margin and lip) under the supports.

#### Scenario: Base pan with margin
- **WHEN** the user enables a base pan with margin 4 mm and thickness 0.8 mm
- **THEN** the generated base pan extends 4 mm beyond the support footprint and is 0.8 mm thick.

### Requirement: Per-model support visibility and clearing

The system SHALL store generated supports per model, allow the user to toggle their visibility, and provide a "Clear supports" action that removes them from the active model only.

#### Scenario: Clear leaves other models intact
- **WHEN** the user clears supports on model A while model B also has supports
- **THEN** model A has no supports and model B's supports remain unchanged.
