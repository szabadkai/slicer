# SliceLab

A browser-based SLA/DLP 3D printing slicer. Upload STL models, orient them optimally, generate supports, configure print settings, and export sliced files ready for your resin printer.

## Features

- **STL Model Loading** – Drag and drop or browse to load your 3D models
- **Model Manipulation** – Move, rotate, and scale your models with intuitive controls
- **Auto-Orientation** – Optimize model orientation for fastest print, least support material, or best quality
- **Support Generation** – Automatic support generation with customizable density, overhang angles, and cross-bracing
- **Layer Slicing** – Preview individual layers with adjustable layer height
- **Print Settings** – Configure exposure times, lift height, speed, and more
- **Export** – Download sliced files as ZIP archives ready for printing

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Usage

1. Load an STL model using the **Load** button
2. Use **Move**, **Rotate**, and **Scale** tools to position your model
3. Click **Orient** to find the optimal printing orientation
4. Use **Supports** to auto-generate support structures
5. Adjust **Job Settings** for your specific resin and printer
6. Click **Slice & Print** to generate the sliced output
7. Export the result as a ZIP file

## Browser Compatibility

SliceLab runs entirely in your browser using WebGL for 3D rendering and Web Workers for heavy computations.

## License

MIT
