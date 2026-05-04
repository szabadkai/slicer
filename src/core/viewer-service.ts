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
      const obj = (
        viewer as unknown as {
          addModel(g: unknown, e: number): { id: string; mesh: { name: string } };
        }
      ).addModel(geometry, 5);
      if (opts?.name) obj.mesh.name = opts.name;
      return obj.id;
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

    // Layer image is rendered to a separate canvas by the layer-preview feature
    setLayerImage(_image: ImageData | null): void {}, // eslint-disable-line @typescript-eslint/no-unused-vars

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
      if (!viewer) throw new Error('ViewerService not initialized');
      return viewer;
    },

    addCutterPreview(positions: Float32Array): string {
      if (!viewer) throw new Error('ViewerService not initialized');
      if (!viewer.addCutterPreview) throw new Error('Viewer does not support cutter preview');
      return viewer.addCutterPreview(positions);
    },

    updateCutterPreview(
      id: string,
      position: [number, number, number],
      rotation: [number, number, number],
      scale: [number, number, number],
    ): void {
      if (!viewer?.updateCutterPreview) return;
      viewer.updateCutterPreview(
        id,
        { x: position[0], y: position[1], z: position[2] },
        { x: rotation[0], y: rotation[1], z: rotation[2] },
        { x: scale[0], y: scale[1], z: scale[2] },
      );
    },

    removeCutterPreview(id: string): void {
      if (!viewer?.removeCutterPreview) return;
      viewer.removeCutterPreview(id);
    },

    setCutterGizmo(id: string, mode: 'translate' | 'rotate' | 'scale'): void {
      if (!viewer?.setCutterGizmo) return;
      viewer.setCutterGizmo(id, mode);
    },

    clearCutterGizmo(): void {
      if (!viewer?.clearCutterGizmo) return;
      viewer.clearCutterGizmo();
    },

    onCutterGizmoChange(
      callback: (
        position: [number, number, number],
        rotation: [number, number, number],
        scale: [number, number, number],
      ) => void,
    ): () => void {
      if (!viewer?.onCutterGizmoChange) return () => {};
      return viewer.onCutterGizmoChange((pos, rot, scl) => {
        callback([pos.x, pos.y, pos.z], [rot.x, rot.y, rot.z], [scl.x, scl.y, scl.z]);
      });
    },

    getModelPositions(modelId: string): Float32Array | null {
      if (!viewer?.getModelPositions) return null;
      return viewer.getModelPositions(modelId);
    },
  };

  return service;
}
