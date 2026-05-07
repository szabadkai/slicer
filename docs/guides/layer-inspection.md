# Layer Inspection

After slicing, SliceLab gives you several tools to check the print before committing to an export.

## Scrubbing through layers

Drag the **layer slider** or use the arrow keys to move through the sliced layers one at a time:

| Key | Action |
|---|---|
| `←` / `→` | Previous / next layer |
| `PgUp` / `PgDn` | Back / forward 10 layers |
| `Home` / `End` | First / last layer |

The layer preview renders at full printer resolution — what you see is exactly what the printer will expose onto the FEP film.

## Islands (unsupported geometry)

An **island** is a region of exposed pixels in a layer that has no connected pixels in the layer below it. In physical terms, the freshly-cured resin in that island has nothing to bond to — it will either float free in the vat or peel off the FEP film and ruin the print.

Click **Detect Islands** to scan all layers. Islands are highlighted in the preview. Common causes:

- A support was missed during the support-generation step
- The model has a small floating detail (handle, arm, thin protrusion) that separates from the main body at some layers
- The overhang angle threshold was set too high and some faces weren't supported

**Fix:** Go back to the Supports panel, add supports to the unsupported region, and re-slice.

## Peel force chart

The **peel force chart** shows the approximate separation force required for each layer. The force is proportional to the white pixel area in that layer — the more resin being cured at once, the harder it is to peel the layer off the FEP.

Spikes in the chart indicate:

- **Support raft layers** — the base pans produce a large continuous white region
- **Model cross-section peaks** — where the widest part of the model (or support tree) meets the plate
- **Dense support clusters** — many pillars grouped together

Very high peaks risk FEP film damage, print delamination, or motor stall on slower printers. If you see an extreme spike, consider:

- Splitting the model into two separate plates
- Reducing base pan width
- Tilting the model to stagger the support cross-sections

## Cross-section area graph

The area graph (below the layer slider) plots the exposed pixel area of each layer as a bar chart. It's a quick visual summary of where the peel force peaks are and how the model bulk is distributed vertically.

## Layer inspector modal

Click on any layer in the preview to open the **layer inspector modal** with a zoomed view. Useful for checking:

- Edge sharpness on fine details
- Pixel bleed on thin walls
- Exact boundary of a support contact point

Press `Esc` to close the inspector.

## Tips

- Check the first 10 layers carefully — if the base is wrong (warped, islands on layer 1), the rest of the print doesn't matter
- Check the last few layers too — thin tops and fine tips are prone to over-exposure artefacts
- A smooth, gradually increasing then decreasing area graph suggests a well-oriented model; sharp spikes or a "shark fin" shape suggests the orientation could be improved
