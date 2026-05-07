# Exporting

SliceLab can export in two modes: **slice export** (PNG layers for printing) and **mesh export** (geometry for further editing or sharing).

## Slice export — PNG layer archive (ZIP)

After slicing, click **Export…** → **Export print package** to download a ZIP file containing:

```
slicelab-plate/
  layer_0001.png
  layer_0002.png
  ...
  layer_NNNN.png
  metadata.json
```

Each PNG is a binary (black and white) image at your printer's native resolution. White pixels represent cured resin; black pixels are transparent. This format is compatible with any printer that accepts a folder of layer images (most DLP/LCD printers in raw mode, or via ChiTuBox/Lychee/UVtools import).

### metadata.json

The metadata file records all settings used for the slice:

```json
{
  "printer": "Anycubic Photon Mono X",
  "resolution": [3840, 2400],
  "buildVolume": [196, 122, 245],
  "layerHeight": 0.05,
  "normalExposure": 2.0,
  "bottomLayers": 6,
  "bottomExposure": 30.0,
  "liftHeight": 8.0,
  "liftSpeed": 3.0,
  "layerCount": 1200,
  "volumes": {
    "model": 12.4,
    "supports": 3.2,
    "total": 15.6
  },
  "printTime": "4h 23m"
}
```

This file is useful for record-keeping and for re-importing settings if you need to re-slice.

## Batch export — all plates

If you have multiple build plates, click **Export…** → **Export all sliced plates** to download a separate ZIP for each plate. Only plates that have been sliced are included.

`Ctrl+Shift+E` is the keyboard shortcut for export all.

## Mesh export (STL / OBJ / 3MF)

Right-click on the viewport (or use the context menu) to export the current model as a mesh file. Use this when you want to:

- Share the oriented, hollowed, or cut model with someone else for slicing in a different tool
- Archive the model at a specific modification stage
- Import into another application for further processing

| Format | Best for |
|---|---|
| **STL** | Universal compatibility; no colour or metadata |
| **OBJ** | Interop with Blender, Maya, and other DCC tools; supports UV maps |
| **3MF** | Modern format with units, scale, and metadata embedded; best for CAD round-trips |

Mesh export does **not** include supports — support geometry is slicer-internal and is not meaningful in external tools.

## Tips

- Slice → verify in layer preview → export in a single session; closing the tab or reloading clears the slice cache (the project is autosaved, but sliced layers are not persisted)
- Check `metadata.json` for volume data before discarding a ZIP — it's the most convenient record of how much resin a print consumed
- If your printer software only accepts `.photon`, `.ctb`, or similar proprietary formats, use UVtools to convert the PNG ZIP — it reads the `metadata.json` settings automatically
