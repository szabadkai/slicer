# Hollow & Drain

Hollowing removes interior volume from a solid model, leaving a shell. For large models this can save significant resin — sometimes 80% or more of the volume.

## Wall thickness

The **wall thickness** slider sets how thick the remaining shell will be. Practical guidance:

| Thickness | Use case |
|---|---|
| 1.0–1.5 mm | Very small parts; brittle, handle carefully |
| 2.0 mm | General purpose minimum — safe for most standard resins |
| 2.5–3.0 mm | Parts under mechanical stress or printed in tough resin |
| 4.0 mm+ | Usually not worth hollowing at this point |

2 mm is the recommended starting point. If the **thin wall warning** indicator lights up, some regions of the shell are below your threshold — increase wall thickness or reduce the hollow depth.

## The drain hole problem

A hollow SLA print has a sealed internal cavity. During printing, the UV-cured resin inside heats and the uncured resin expands — this creates suction on each layer separation (peel). Without a drain hole:

- The suction force can crack or delaminate the part
- Uncured resin stays trapped inside and adds weight
- Post-cure heat can pressurise the cavity and crack the walls

Every hollow model needs at least two drain holes — one for resin to flow out, one to let air in.

## Drain hole workflow

1. Click **Auto-Place Drain Holes** — SliceLab analyses the geometry and places holes at the lowest points of the interior volume
2. Check the placement visually; drag holes if needed
3. Set **hole diameter** (3–5 mm is typical; larger holes drain faster)
4. *(Optional)* Enable **Generate Drain Plugs** to create matching plugs you can glue in after washing and curing

## Trap analysis

Even with drain holes placed, some concave geometries create interior pockets that resin can't drain from. Click **Run Trap Analysis** to detect these voids. The result shows:

- **Trapped volume** — estimated ml of resin that would remain
- **Suggested additional holes** — positions that would allow drainage

Accept the suggestions or place holes manually. Re-run analysis after changes to verify.

## Model splitting

For models where drain access is impossible from outside (e.g., a closed sphere with internal geometry), use **Split** to cut the hollow model into two halves that can be drained separately and glued together after post-processing.

## Tips

- Hollow *after* orienting and generating supports — hollowing changes the mesh, which invalidates supports
- Run trap analysis even if you've placed drain holes manually — you can miss non-obvious pockets
- If you need the model to look solid from the outside (no visible holes), position drain holes on hidden faces, or use the drain plug feature
