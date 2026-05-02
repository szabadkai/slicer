# SliceLab

A browser-based SLA/DLP resin slicer that runs entirely in your browser. No installs, no backends -- just open it and start slicing.

This is a personal testbed for experimenting with ideas around SLA slicing workflows: orientation algorithms, support generation strategies, GPU-accelerated layer slicing, and whatever else comes to mind. It's not trying to replace production slicers -- it's a playground for exploring what's possible in the browser.

**[Try it live](https://szabadkai.github.io/slicer/)**

![SliceLab screenshot](public/screenshot.png)

## What it does

- **Load STL models** -- drag and drop or browse
- **Transform** -- move, rotate, scale with visual gizmos
- **Auto-orient** -- genetic algorithm evaluates 26+ candidate orientations, optimizing for print speed, support usage, or surface quality
- **Support generation** -- automatic overhang detection with configurable density, angle threshold, cross-bracing, base pans, and tip tapering
- **GPU-accelerated slicing** -- stencil-buffer based layer slicing (Formlabs-style algorithm) running on WebGL
- **Layer preview** -- scrub through sliced layers in real time
- **Volume estimation** -- mesh-based pre-slice and pixel-based post-slice volume calculation
- **Multi-plate** -- manage multiple build plates with per-plate slice caching
- **21 material presets** -- Siraya Tech, Anycubic, Elegoo resins with accurate visual properties
- **10 printer profiles** -- Anycubic, Elegoo, Creality, Phrozen, Formlabs, UniFormation
- **Print time estimation** -- based on layer count, exposure, lift speeds
- **Export** -- STL, OBJ, 3MF, or sliced PNG layer archive with metadata

## Getting started

```bash
npm install
npm run dev
```

Or just open the **[live version](https://szabadkai.github.io/slicer/)** -- nothing to install.

## License

MIT
