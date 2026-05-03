/**
 * SliceLab – main bootstrap (≤100 LOC).
 * Creates Viewer + Slicer, loads preferences, mounts all feature panels.
 */
import type { LegacyViewer, LegacySlicer, LegacyPlate } from '@core/legacy-types';
import type { AppContext, ProjectState } from '@core/types';
import { showProgress, updateProgress, hideProgress } from '@features/app-shell/progress';
import { mountApp } from '@features/app-shell/mount';

async function init(): Promise<void> {
  const canvas = document.getElementById('viewport') as HTMLCanvasElement;
  if (!canvas) throw new Error('Missing #viewport canvas');

  // Dynamic imports — keeps THREE.js out of the main type graph
  const { Viewer } = await import('./viewer') as unknown as { Viewer: new (c: HTMLCanvasElement) => LegacyViewer };
  const { Slicer, PRINTERS } = await import('./slicer') as {
    Slicer: new () => LegacySlicer;
    PRINTERS: Record<string, import('@core/types').PrinterSpec>;
  };
  const { createPlate } = await import('./plates') as {
    createPlate: (n: number) => LegacyPlate;
  };

  const viewer = new Viewer(canvas);
  const slicer = new Slicer();
  const project: ProjectState = {
    plates: [createPlate(1)],
    activePlateId: '',
  };
  project.activePlateId = project.plates[0].id;
  viewer.bindInitialPlate(project.plates[0]);

  // Shared helpers — filled in by mountApp and passed to panels
  const ctx: AppContext = {
    viewer,
    slicer,
    project,
    showProgress,
    updateProgress,
    hideProgress,
    // These are filled by mountApp → shell/panels set them
    showToolPanel: () => {},
    scheduleProjectAutosave: () => {},
    scheduleSavePreferences: () => {},
    updateEstimate: () => {},
    renderPlateTabs: () => {},
    clearActivePlateSlice: () => {},
  };

  mountApp(ctx, PRINTERS);
}

init().catch((err) => {
  console.error('Failed to initialize SliceLab:', err);
});


