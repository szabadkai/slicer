## ADDED Requirements

### Requirement: Inspect geometry for printability issues

The system SHALL analyze the active model's geometry and produce a report of issues categorized by type and severity. Issue types SHALL include at least: non-manifold edges, holes (boundary loops), flipped or inconsistent normals, self-intersections, and degenerate triangles. Severity SHALL be one of `info`, `warning`, `error`.

#### Scenario: Report a hole
- **WHEN** the user runs inspection on a model with a missing triangle on a closed surface
- **THEN** the report contains at least one `holes` issue with `error` severity and the affected boundary edges are visualized in the viewport.

#### Scenario: Clean mesh produces an empty report
- **WHEN** the user runs inspection on a watertight, manifold cube
- **THEN** the report contains zero issues and the inspector shows a "healthy" state.

### Requirement: One-click repair pipeline

The system SHALL provide a repair action that runs a configured pipeline (close holes, weld near-duplicate vertices, recompute normals, remove degenerate triangles, fix winding) and replaces the geometry with the repaired result, keeping the original transform.

#### Scenario: Repair fixes flipped normals
- **WHEN** the user runs repair on a model whose normals point inward
- **THEN** the normals are recomputed outward and re-running inspection no longer reports a normals issue.

#### Scenario: Repair preserves transform
- **WHEN** a model is moved to (10, 0, 5), rotated 30°, then repaired
- **THEN** the repaired model retains position (10, 0, 5) and rotation 30°.

### Requirement: Health badge in the model inspector

The system SHALL show a health badge on each model summary in the inspector with a color (green / yellow / red) reflecting the worst issue severity, and clicking the badge SHALL open the full health report.

#### Scenario: Badge updates after repair
- **WHEN** a model with red badge is repaired into a clean state
- **THEN** the badge transitions to green within one second of the repair completing.
