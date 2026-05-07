/**
 * Tour step definitions.
 * targetSelector must match IDs in index.html (all verified).
 */

const DOCS_BASE = 'https://github.com/szabadkai/slicer/blob/main/docs/guides';

export interface TourStep {
  id: string;
  title: string;
  body: string;
  targetSelector: string;
  panelName?: string;
  sampleModel?: boolean;
  docsUrl?: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to SliceLab',
    body: "A d20 has been loaded so you have something to work with. SliceLab prepares resin models for SLA/DLP printing — right in your browser, with no install or account needed. Let's walk through the main workflow.",
    targetSelector: '#viewport-container',
    panelName: 'plate',
    sampleModel: true,
  },
  {
    id: 'load',
    title: 'Load Your Model',
    body: 'Drag an STL, STEP, or IGES file onto the viewport, or click here to browse. The project is auto-saved to your browser so you can pick up where you left off.',
    targetSelector: '#plate-btn',
    panelName: 'plate',
  },
  {
    id: 'orient',
    title: 'Find the Best Orientation',
    body: 'Orientation is the biggest factor in print quality and support volume. Click a preset — the algorithm evaluates 26+ candidate angles and picks the best. Try Least Support for a clean starting point.',
    targetSelector: '#orient-btn',
    panelName: 'orient',
    docsUrl: `${DOCS_BASE}/orientation.md`,
  },
  {
    id: 'supports',
    title: 'Generate Supports',
    body: 'Auto-Generate creates a support tree based on your overhang angle. Enable Show Unsupported Areas to verify coverage. Click Manual Placement to add individual pillars where needed.',
    targetSelector: '#support-tool-btn',
    panelName: 'supports',
    docsUrl: `${DOCS_BASE}/supports.md`,
  },
  {
    id: 'modify',
    title: 'Hollow & Modify',
    body: 'For large solid models, hollowing can save 70–80% of resin. Set wall thickness, auto-place drain holes, and run Trap Analysis to catch hidden voids before printing.',
    targetSelector: '#modify-btn',
    panelName: 'modify',
    docsUrl: `${DOCS_BASE}/hollow-and-drain.md`,
  },
  {
    id: 'slice',
    title: 'Slice & Verify',
    body: 'Choose a profile — Standard works for most prints. Press Ctrl+S or click Slice Plate. Use the layer preview to scrub through slices, detect islands, and measure dimensions. Check Model Health for mesh issues before exporting.',
    targetSelector: '#slice-tool-btn',
    panelName: 'slice',
    docsUrl: `${DOCS_BASE}/slicing-and-profiles.md`,
  },
  {
    id: 'export',
    title: 'Export Your Print File',
    body: "Click Export… to download a ZIP with PNG layers and a metadata file — ready for your printer's software. You can also export as STL, 3MF, or OBJ for further editing.",
    targetSelector: '#footer-actions',
    panelName: 'slice',
    docsUrl: `${DOCS_BASE}/exporting.md`,
  },
];
