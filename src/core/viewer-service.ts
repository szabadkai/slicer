import type { ViewerService, ModelHandle, PrinterSpec } from './types';
import type { LegacyViewer } from './legacy-types';

export type { ViewerService };

/**
 * Bridge adapter: wraps the legacy Viewer class (src/viewer.js) behind
 * the typed ViewerService interface. This lets new features talk to
 * the rendering layer without importing THREE.js directly.
 */
export function createViewerService(canvas: HTMLCanvasElement): ViewerService {
  // Dynamic import avoids pulling THREE.js into the type-checked module graph.
  // The legacy Viewer is loaded at runtime via the ESM bundle.
  let viewer: LegacyViewer | null = null;

  const service: ViewerService = {
    get canvas() {
      return canvas;
    },

    async init(): Promise<void> {
      const { Viewer } = await import('../viewer');
      viewer = new Viewer(canvas) as unknown as LegacyViewer;
      return Promise.resolve();
    },

    addModel(geometry: unknown, opts?: { name?: string }): string {
      if (!viewer) throw new Error('ViewerService not initialized');
      const obj = viewer.addModel(geometry, 5);
      if (opts?.name) obj.mesh.name = opts.name;
      return obj.id as string;
    },

    removeModel(id: string): void {
      if (!viewer) return;
      viewer.selectObject(id);
      viewer.removeSelected();
    },

    getModel(id: string): ModelHandle | undefined {
      if (!viewer) return undefined;
      const obj = viewer.objects.find((o: { id: string }) => o.id === id);
      if (!obj) return undefined;
      return { id: obj.id, name: obj.mesh.name || obj.id };
    },

    setLayerImage(_image: ImageData | null): void { // eslint-disable-line @typescript-eslint/no-unused-vars
      // Layer image is rendered to a separate canvas by the layer-preview feature
    },

    setPrinter(spec: PrinterSpec): void {
      if (!viewer) return;
      viewer.setPrinter(spec);
    },

    render(): void {
      if (!viewer) return;
      viewer.requestRender();
    },

    // ─── Extended API for feature integration ────────────
    get legacy(): LegacyViewer {
      return viewer;
    },
  };

  return service;
}

