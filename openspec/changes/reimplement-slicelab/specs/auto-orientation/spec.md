## ADDED Requirements

### Requirement: Generate candidate orientations

The system SHALL evaluate at least 26 axis-aligned candidate orientations (6 face-aligned, 12 edge-aligned, 8 corner-aligned) for the active model and score each against the user-selected strategy.

#### Scenario: All 26 directions evaluated
- **WHEN** the user runs auto-orient on any non-empty geometry
- **THEN** the engine reports scores for at least 26 distinct candidate up-vectors before refinement.

### Requirement: Scoring strategy presets

The system SHALL offer three strategy presets — `print-speed`, `minimal-supports`, `surface-quality` — that weight the orientation score by total height, projected overhang area, staircase artifact metric, and flat-bottom area.

#### Scenario: Selecting "minimal supports" prefers low overhang area
- **WHEN** the user picks `minimal-supports` and runs auto-orient on a model with a clear low-support orientation
- **THEN** the chosen orientation has the smallest overhang area among the top three candidates.

#### Scenario: Selecting "print-speed" prefers low height
- **WHEN** the user picks `print-speed` and runs auto-orient on a tall narrow model
- **THEN** the chosen orientation lays the model on its longest side.

### Requirement: Genetic-algorithm refinement in a Web Worker

The system SHALL refine the top candidates with a small genetic algorithm running in a dedicated Web Worker, posting progress and final result back to the main thread without blocking the UI.

#### Scenario: UI stays responsive during optimization
- **WHEN** the user runs auto-orient on a 500k-triangle model
- **THEN** the main-thread frame time stays under 50 ms during optimization and a progress indicator updates at least every 500 ms.

#### Scenario: Cancel mid-run
- **WHEN** the user clicks "Cancel" while optimization is running
- **THEN** the worker terminates within 500 ms and the model orientation is unchanged.

### Requirement: Protected face constraint

The system SHALL allow the user to designate a face on the model as "protected", and SHALL exclude orientations that would place that face in contact with the build plate or under support.

#### Scenario: Protected face prevents orientation choice
- **WHEN** the user picks a face as protected and runs auto-orient
- **THEN** every evaluated orientation keeps the protected face's normal component along the build axis ≥ 0 (face points away from the plate).

### Requirement: Apply or preview result

The system SHALL show the chosen orientation as a preview and require an explicit "Apply" before the model's transform is changed; the user SHALL be able to dismiss the preview without applying.

#### Scenario: Dismiss preview
- **WHEN** the user dismisses the orientation preview
- **THEN** the model rotation reverts to the value before auto-orient ran.
