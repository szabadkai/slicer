# Orientation

Getting orientation right is the single biggest lever you have for print quality. A well-oriented model uses less support, has fewer visible layer lines on cosmetic surfaces, and prints faster.

## How the algorithm works

SliceLab's auto-orientation uses a **genetic algorithm** that evaluates 26+ candidate orientations and scores each one using weighted objectives. For each candidate it calculates:

- **Print height** — taller prints take longer and are more likely to delaminate
- **Overhang area** — more overhang means more supports, more resin, and more removal work
- **Staircase effect** — surfaces angled between ~15° and ~45° from horizontal get the most visible layer stepping
- **Flat surface on base** — a large flat contact region on the build plate improves first-layer adhesion

The algorithm runs this scoring pass across all candidates and returns the orientation with the best combined score for the preset you selected.

## Presets

| Preset | Optimises for | Best used when |
|---|---|---|
| **Fastest** | Minimum print height | You're doing a test print or iterating quickly |
| **Least Support** | Minimum overhang area | You want the cleanest surface post-processing and easy removal |
| **Best Quality** | Minimum staircase effect on visible surfaces | The model has large curved surfaces and appearance matters |

## Custom weights

Open the **Custom** section in the Orient panel to tune the four sliders yourself:

- **Height** — how much to penalise tall orientations
- **Overhang** — how much to penalise unsupported area
- **Staircase** — how much to penalise layer-line visibility on angled faces
- **Flat base** — how much to reward a large flat region touching the plate

Increasing a slider raises that objective's weight relative to the others. A weight of 0 means the algorithm ignores that criterion entirely. The default preset values are shown when you switch back to a named preset.

## Surface intent biasing

If you've painted surface intents (see the Surface panel), the orientation algorithm takes them into account. Faces marked **cosmetic** are penalised if they end up facing a support-prone angle; faces marked **hidden** are ignored. This lets you tell the algorithm "I don't care what happens to this face, but keep that face clean."

## Batch orient

The **Orient All** button selects every object on the active plate and runs orientation in sequence. Each model gets its own result; the algorithm doesn't try to optimise cross-model relationships.

## Tips

- Run orient *before* generating supports — supports depend on the final orientation.
- If the auto result looks wrong, try switching presets before reaching for Custom Weights.
- Orientation runs on the CPU and typically takes 0.5–3 seconds per model depending on mesh complexity.
