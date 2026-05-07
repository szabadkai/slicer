# Slicing & Profiles

SliceLab's slicer runs entirely on the GPU using a WebGL stencil-buffer algorithm. Each layer is rendered as a cross-section of the 3D model at a specific Z height, then read back as a binary PNG image.

## Layer height

Layer height is the vertical resolution of the print. It directly affects both **print quality** and **print time**.

| Layer height | Effect |
|---|---|
| 0.025 mm | Very high detail; slow; use for jewellery or dental models |
| 0.05 mm | Standard — a good balance for most prints |
| 0.10 mm | Fast; visible layer lines on shallow-angled surfaces |
| 0.15–0.20 mm | Draft quality; useful for early prototypes |

Lower layer height = more layers = longer print. A 50 mm tall model at 0.05 mm produces 1000 layers; at 0.10 mm it's 500 layers.

## Built-in profiles

| Profile | Layer height | Normal exposure | Bottom layers | Bottom exposure | When to use |
|---|---|---|---|---|---|
| **Fast** | 0.10 mm | 1.5 s | 5 | 25 s | Test prints, fit checks |
| **Standard** | 0.05 mm | 2.0 s | 6 | 30 s | Most prints — good default |
| **High Detail** | 0.025 mm | 2.5 s | 8 | 40 s | Miniatures, dental, jewellery |

Exposure times are starting points for Siraya Tech Fast resins. Adjust ±20% based on your resin and lamp output.

## Custom profiles

Dial in settings that work for your printer and resin, then click **Save Profile** and give it a name. Saved profiles appear in the dropdown alongside the three built-in ones. Delete profiles you no longer need from the same dropdown.

## Adaptive layer height

Enable **Adaptive Layers** to let SliceLab vary layer height automatically based on surface angle:

- Surfaces nearly perpendicular to the plate (walls) get thicker layers — they gain little from thin layers
- Surfaces nearly parallel to the plate (flat tops/bottoms) stay at the minimum layer height
- The transition is smooth — no visible seam where layer height changes

Adaptive layers can reduce print time by 20–40% on models with mixed geometry without sacrificing visible surface quality.

## Dimensional compensation

Resin shrinks slightly during UV curing. For parts that need to fit precisely (mechanical assemblies, snap fits), enable **Dimensional Compensation** and enter a scale factor. A typical value is 0.5–1.0% expansion to compensate for shrinkage. Measure a calibration print and adjust accordingly.

## Per-region exposure

If you've painted surface intents, regions marked **reliability-critical** receive a longer exposure time to ensure full cure; regions marked **cosmetic** may receive a slightly shorter exposure to reduce bleeding at edges. This is applied automatically when you slice — no manual configuration needed.

## Gyroid infill

Instead of printing solid interior volumes, enable **Gyroid Infill** to replace them with a gyroid lattice. This:

- Reduces resin consumption (similar to hollowing, but without drain holes)
- Adds mechanical isotropy — the gyroid structure is equally strong in all directions
- Is not suitable for watertight parts (the lattice is open)

Set the infill density (%) to control the ratio of solid to void.

## Slice pre-flight

Before slicing, SliceLab runs a quick pre-flight check:

- Checks for unrepaired mesh issues that would cause artefacts in slice images
- Warns if any models extend beyond the printer's build volume
- Warns if no supports are present for objects with overhangs

Warnings don't block slicing — they're informational.

## Tips

- Always match exposure times to your specific resin — built-in profiles are baselines, not final values
- Slice *after* all mesh modifications (hollow, supports, boolean ops) — slicing is invalidated whenever the mesh changes
- Use the layer inspector (arrow keys after slicing) to check the first few layers and the last few layers before exporting
