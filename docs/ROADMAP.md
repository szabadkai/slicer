# SliceLab Roadmap

This roadmap focuses SliceLab on resin-printing workflows where users need fewer
failed prints, faster support cleanup, and reliable printer-ready output without
moving between multiple tools.

The target user is a resin-printing power user: miniature painters, small-batch
model makers, tabletop creators, and technical resin users who understand that
supports, hollowing, drains, exposure, and slice validation all affect print
success. SliceLab should stay an integrated browser slicer, not a collection of
separate specialist tools.

## Product Direction

The workflow should remain:

1. Load and arrange models.
2. Orient for print success and surface quality.
3. Add and refine supports.
4. Hollow, drain, and check trapped resin risk.
5. Slice and inspect layer-level failure modes.
6. Export a printer-ready package or a clean handoff package.

New features should plug into the panel that already owns the user's current
decision:

- Supports panel: support creation, support editing, unsupported-region review.
- Modify / Hollow & Drain: shell thickness, drain placement, resin traps.
- Layer Preview: post-slice validation, issue navigation, slice repair.
- Export: printer package generation and UVtools-compatible handoff.

## Priority Roadmap

### P0 - Immediate Workflow Wins

1. **Support presets**

   Add Nano, Micro, Light, Medium, and Heavy support presets. Presets should
   drive tip diameter, shaft diameter, base radius, sphere connection diameter,
   branch radii, and default density.

   This is the fastest way to make manual and automatic support work feel less
   numerical. Keep the current custom controls as overrides.

   **Status:** Implemented. SliceLab now exposes Nano, Micro, Light, Medium, and
   Heavy preset buttons in the Supports panel. Presets apply auto and manual
   support dimensions plus density, while still allowing custom numeric edits.

2. **Support island navigator**

   Add a Supports-panel island workflow: Detect, Previous, Next, Focus, Mark
   Resolved, and optionally Hide Resolved. The camera should jump to the active
   unsupported region and the overhang overlay should make the issue obvious.

   This should use SliceLab's existing support/overhang architecture rather than
   creating a separate validator mode.

   **Status:** Implemented as a geometry-based v1. The Supports panel can scan
   the selected model for uncovered overhang clusters, navigate between detected
   regions, focus the camera, enable the unsupported-area overlay, and mark
   regions resolved for the current scan.

   **Deferred:** Slice-based island navigation, persistent resolved state,
   per-region support suggestions, and automatic placement from a selected
   region are intentionally left for later milestones.

3. **Post-slice QA summary**

   After slicing, show a compact issue list in Layer Preview. Start with
   existing signals: islands, empty layers, touching bounds, high peel-force
   layers, and large cross-section spikes.

   The output should be navigable, not just informational. Clicking an issue
   should move the layer slider and zoom the layer inspector to the region.

   **Status:** Implemented. The Layer Preview QA check aggregates slice islands,
   empty layers, touching-bounds warnings, and peel-force peaks/spikes into one
   navigable issue list. QA issues also populate the layer inspector issue list.

   **Deferred:** Suction cup detection, layer-level resin trap detection,
   before/after repair highlighting, and pixel-level repair are not included in
   this first QA pass.

4. **Empty layer and touching-bounds detection**

   Add simple layer-level checks before tackling harder slice repair problems.
   Empty layers in the middle of a print and pixels touching the printable bounds
   are cheap to detect and high-signal for users.

   **Status:** Implemented as part of the post-slice QA summary because the QA
   list needed more than islands and peel-force data to be useful.

5. **UI cleanup and dark mode polish**

   Tighten the current app chrome before adding too many new expert controls.
   Prioritize denser panel grouping, clearer primary actions, consistent control
   spacing, and dark-mode contrast/readability fixes across Supports, Hollow &
   Drain, Layer Preview, and Export.

   This is product work, not decoration: the target user will spend long sessions
   inspecting dense geometry and slice images, so visual noise and weak contrast
   directly hurt print-prep speed.

### P1 - Failure-Mode Coverage

6. **Suction cup detection**

   Detect slice regions that form sealed or near-sealed cups over consecutive
   layers. Report layer range, approximate area, and severity.

   Recommended actions should point users back to Hollow & Drain when a geometry
   fix is appropriate.

7. **Layer-level resin trap detection**

   Keep the current geometry-space trap analysis, but add post-slice trap
   warnings. Geometry analysis answers "is this model designed to drain";
   layer-level analysis answers "will this sliced print trap resin".

   The UI should distinguish small traps that can be safely filled from large
   traps that need drain placement or model changes.

8. **UVtools-style highlighted fixes**

   When SliceLab detects a layer-level issue, highlight the exact pixels or
   contours it proposes to change before any repair is applied. Use before/after
   overlays in the Layer Preview rather than a separate repair dialog.

   This should cover tiny island removal, pinhole filling, resin-trap fill
   candidates, and touching-bounds cleanup. The goal is the confidence UVtools
   gives users when reviewing automated fixes, while keeping the interaction
   native to SliceLab.

9. **Unified slice issue navigator**

   Consolidate islands, suction cups, resin traps, empty layers, touching bounds,
   and peel-force spikes into one Layer Preview issue list. Each issue should
   carry a severity, layer/layer range, affected area, and recommended next
   action.

10. **Fill voids**

    Add a controlled way to fill internal voids or resin pockets that should not
    remain hollow. This can start as a mesh-space operation in Hollow & Drain and
    later gain a layer-space repair option for small sealed pockets.

    The UI must distinguish this from hollowing and drain placement: filling a
    void spends resin to remove a failure mode, while hollowing saves resin and
    creates drain obligations.

### P2 - Faster Manual Supports

11. **Interactive auto-branch mode**

   Add a support mode where clicking a new contact point tries to attach the new
   support to a nearby larger existing support. If no valid parent exists, fall
   back to a routed grounded pillar.

   This should build on the existing experimental support-structure graph and
   collision checks.

12. **Base bracing without base pan**

   Add an option to generate low base-layer bracing/feet between support bases
   without creating a full raft/pan. This should improve support stability while
   saving resin compared with the current base pan.

   Treat it as a support-foundation mode alongside None, Base Bracing, and Base
   Pan, rather than another independent checkbox.

13. **Line fill supports**

   Let users select two existing support/contact points, or click two model
   points, then populate supports along the line with preset and spacing
   controls.

   This is the first pattern tool to add because it is predictable and useful on
   long edges, weapons, capes, base rims, and mechanical overhangs.

14. **Draggable support tips**

    Let users drag an existing support contact across the model surface, then
    re-route the support while preserving its preset and origin. Movement should
    be constrained to raycast model surfaces.

15. **Arc fill supports**

    Let users define a three-point arc and populate it with supports. This
    follows naturally after line fill and is valuable for circular bases,
    shields, decorative rims, tails, and curved miniature features.

16. **Smart support selection**

    Add selection filters for preset, tip size, height range, auto/manual origin,
    branch/pillar kind, and support contribution. Bulk editing should reuse
    current support settings rather than introducing a separate inspector.

17. **Multi-joint branching and segmented pillars**

    Evaluate whether supports should support multiple joints/breaks per branch
    or pillar route. This could allow tree structures that route around complex
    model geometry more naturally than one junction plus one trunk, and could
    let single pillars bend through multiple collision-safe waypoints.

    Start with a design spike before implementation. The key questions are
    whether this materially improves printability, whether editing remains
    understandable, and whether the existing `SupportStructure` graph can express
    it without turning ordinary support edits into graph surgery.

### P3 - Conservative Slice Repair

18. **Small-issue auto repair**

    Add previewable, undoable pixel-level repair for narrowly defined cases:
    remove tiny isolated islands, fill tiny pinhole traps, and remove stray empty
    noise layers.

    Avoid broad destructive repair until diagnostics are trustworthy and users
    can inspect before/after layers.

19. **Layer pixel editor**

    Add direct paint/erase tools for sliced layers only after issue detection and
    conservative repair are mature. This should be a surgical expert tool inside
    Layer Preview, not a primary workflow.

### P4 - Export And Calibration Depth

20. **UVtools-friendly handoff**

    Keep SliceLab's implementation clean-room and do not copy UVtools code.
    Improve the exported PNG ZIP metadata so UVtools can consume it cleanly, and
    document the recommended handoff for users whose printers require proprietary
    formats.

21. **Native export hardening**

    Harden `.goo` output first, then evaluate clean-room OSLA or UVJ export. Do
    not chase every proprietary printer format before post-slice QA is stronger.

22. **Calibration workflows**

    Add resin exposure finder, dimensional calibration, elephant-foot
    compensation tests, and lift/rest timing helpers. These belong in the Slice
    workflow because they tune the same settings used at export time.

## Licensing And Integration Notes

Runebrace and UVtools are useful product benchmarks, but SliceLab should not copy
their UI or source code. UVtools is AGPL-3.0, so importing or porting its code
would create licensing obligations that do not fit the current project shape.

Acceptable integration directions:

- Clean-room implementations of comparable diagnostics and workflows.
- Optional handoff packages that open well in UVtools.
- Future desktop/native wrapper integration that shells out to a user-installed
  UVtools binary as a separate tool.

Avoid:

- Copying UVtools source into SliceLab.
- Porting UVtools algorithms line-by-line.
- Depending on `UVtools.Core` from the browser app unless the project is ready
  for AGPL implications.

## Design Guardrails

- Keep issue navigation close to the viewport or layer preview it controls.
- Prefer compact expert controls over marketing-style pages or explanatory
  panels.
- Use existing panel structure and event-based feature boundaries.
- Keep destructive operations previewable and undoable.
- Add one focused workflow at a time; avoid a broad "advanced tools" drawer that
  hides unrelated behavior.
