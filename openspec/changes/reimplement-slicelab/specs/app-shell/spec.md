## ADDED Requirements

### Requirement: Workflow-staged sidebar

The system SHALL present capability panels grouped into five ordered workflow stages — `Prepare`, `Orient`, `Support`, `Slice`, `Export` — so that only the active stage's controls are visible in the main panel area at any time.

#### Scenario: Stage tab activates the matching panel
- **WHEN** the user clicks the `Support` stage tab
- **THEN** the support generation controls fill the panel area and other stages' controls are hidden (not just collapsed).

#### Scenario: Stages are jumpable, not gated
- **WHEN** the user clicks `Slice` without having generated supports
- **THEN** the slice stage opens normally; supports are simply absent in the slice.

#### Scenario: Active stage is keyboard-cyclable
- **WHEN** the user presses `Tab` (or a configured shortcut) while focus is on the stage bar
- **THEN** the active stage cycles to the next stage in order.

### Requirement: Inspector pane for context detail

The system SHALL provide an inspector pane (separate from the stage panel) that shows context-sensitive detail for the current selection: model summary in `Prepare`, orientation preview in `Orient`, support stats in `Support`, layer scrubber in `Slice`, export summary in `Export`.

#### Scenario: Inspector swaps with stage
- **WHEN** the user switches from `Prepare` to `Slice` with a sliced plate
- **THEN** the inspector swaps from the model summary to the layer scrubber automatically.

#### Scenario: Empty state is informative
- **WHEN** no model is selected and the user is on `Prepare`
- **THEN** the inspector shows a short hint ("Select a model to inspect") instead of being blank.

### Requirement: Modal dialogs for ancillary chooser flows

The system SHALL render the printer chooser, the project restore prompt, the keyboard-shortcut reference, and the fullscreen layer inspector as modal dialogs invoked from the relevant stage, each with a close button and `Escape`-to-dismiss.

#### Scenario: Escape dismisses the printer chooser
- **WHEN** the printer chooser modal is open and the user presses `Escape`
- **THEN** the modal closes and focus returns to the trigger control.

#### Scenario: Modals trap focus
- **WHEN** a modal is open and the user presses `Tab` repeatedly
- **THEN** focus cycles only within the modal until it is closed.

### Requirement: Keyboard shortcut reference

The system SHALL provide a discoverable keyboard-shortcut help dialog covering at least: stage navigation, gizmo modes (`W`/`E`/`R`), frame view, undo/redo, slice, and toggle sidebar.

#### Scenario: Open shortcut help
- **WHEN** the user presses `?`
- **THEN** the shortcut dialog opens listing every registered shortcut grouped by stage.

### Requirement: File-size and surface-size budgets

The system SHALL be implemented as feature-sliced ES modules where every source file under `src/` stays at or below 600 lines of code, and only the viewer service and slicing pipeline import `three` directly.

#### Scenario: CI guard rejects oversized files
- **WHEN** a contributor adds a file under `src/` with more than 600 LOC
- **THEN** the CI lint step fails with a message naming the file and its line count.

#### Scenario: CI guard rejects unauthorized THREE imports
- **WHEN** a contributor adds `import * as THREE from 'three'` outside `src/core/viewer-service.js` or `src/features/gpu-slicing/**`
- **THEN** the CI lint step fails with a message naming the file.
