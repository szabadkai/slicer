/**
 * Command handlers for boolean subtract and split operations.
 * Orchestrates: snapshot → generate primitive → boolean → replace model.
 */
import type { AppContext } from '@core/types';
import type { LegacyViewer } from '@core/legacy-types';
import { activeCutter } from '@core/state';
import { commands } from '@core/commands';
import { createPositions, applyTransform } from '@core/primitives';
import { subtractPrimitive, splitByPrimitive } from './ops';
import { pushSnapshot, popSnapshot } from './history';

export function registerBooleanHandlers(ctx: AppContext): () => void {
  const disposers: (() => void)[] = [];

  disposers.push(
    commands.on('boolean-subtract', async ({ modelId }) => {
      const cutter = activeCutter.value;
      if (!cutter) return;

      const viewer = ctx.viewer as unknown as LegacyViewer;
      const modelPositions = viewer.getModelPositions?.(modelId);
      if (!modelPositions) {
        alert('Could not read model geometry. Try repairing the mesh first.');
        return;
      }

      // Save undo snapshot
      const modelObj = viewer.objects.find((o) => o.id === modelId);
      const modelName = modelObj?.mesh?.name ?? modelId;
      pushSnapshot(modelId, modelPositions, modelName);

      // Generate and transform cutter positions
      const rawCutter = createPositions(cutter.params);
      const cutterPositions = applyTransform(rawCutter, cutter.transform);

      ctx.showProgress('Subtracting primitive...');
      try {
        const result = await subtractPrimitive(modelPositions, cutterPositions);
        if (!result.positions) {
          alert(
            'Boolean subtract failed — the mesh may not be watertight.\nTry repairing the mesh first (Inspect → Repair).',
          );
          ctx.hideProgress();
          return;
        }

        // Replace model in viewer
        replaceModelGeometry(viewer, modelId, result.positions, `${modelName} (subtracted)`);

        // Clear cutter
        activeCutter.value = null;
        ctx.clearActivePlateSlice();
      } catch (error) {
        console.error('Boolean subtract failed:', error);
        alert(
          'Boolean subtract failed — the mesh may not be watertight.\nTry repairing the mesh first (Inspect → Repair).',
        );
      } finally {
        ctx.hideProgress();
      }
    }),
  );

  disposers.push(
    commands.on('boolean-split', async ({ modelId }) => {
      const cutter = activeCutter.value;
      if (!cutter) return;

      const viewer = ctx.viewer as unknown as LegacyViewer;
      const modelPositions = viewer.getModelPositions?.(modelId);
      if (!modelPositions) {
        alert('Could not read model geometry. Try repairing the mesh first.');
        return;
      }

      // Save undo snapshot
      const modelObj = viewer.objects.find((o) => o.id === modelId);
      const modelName = modelObj?.mesh?.name ?? modelId;
      pushSnapshot(modelId, modelPositions, modelName);

      const rawCutter = createPositions(cutter.params);
      const cutterPositions = applyTransform(rawCutter, cutter.transform);

      ctx.showProgress('Splitting with primitive...');
      try {
        const result = await splitByPrimitive(modelPositions, cutterPositions);

        // Only remove original if we got at least one part
        if (!result.inside.positions && !result.outside.positions) {
          alert(
            'Boolean split failed — the mesh may not be watertight.\nTry repairing the mesh first (Inspect → Repair).',
          );
          ctx.hideProgress();
          return;
        }

        // Remove original
        viewer.selectObject(modelId);
        viewer.removeSelected();

        // Add inside part
        if (result.inside.positions) {
          addModelFromPositions(viewer, result.inside.positions, `${modelName} (inside)`);
        }

        // Add outside part
        if (result.outside.positions) {
          addModelFromPositions(viewer, result.outside.positions, `${modelName} (outside)`);
        }

        if (!result.inside.positions || !result.outside.positions) {
          const missing = !result.inside.positions ? 'inside' : 'outside';
          alert(
            `Split partially succeeded — the ${missing} part could not be computed.\nThe mesh may not be fully watertight.`,
          );
        }

        // Clear cutter
        activeCutter.value = null;
        ctx.clearActivePlateSlice();
      } catch (error) {
        console.error('Boolean split failed:', error);
        alert(
          'Boolean split failed — the mesh may not be watertight.\nTry repairing the mesh first (Inspect → Repair).',
        );
      } finally {
        ctx.hideProgress();
      }
    }),
  );

  // Undo handler — listen for custom event from panel
  const handleUndo = (e: Event): void => {
    const detail = (e as CustomEvent).detail as { modelId: string } | undefined;
    if (!detail?.modelId) return;

    const viewer = ctx.viewer as unknown as LegacyViewer;
    const snapshot = popSnapshot(detail.modelId);
    if (!snapshot) return;

    replaceModelGeometry(viewer, detail.modelId, snapshot.positions, snapshot.name);
    ctx.clearActivePlateSlice();
  };

  document.addEventListener('boolean-undo', handleUndo);
  disposers.push(() => document.removeEventListener('boolean-undo', handleUndo));

  return () => disposers.forEach((d) => d());
}

function replaceModelGeometry(
  viewer: LegacyViewer,
  modelId: string,
  positions: Float32Array,
  name: string,
): void {
  viewer.selectObject(modelId);
  viewer.removeSelected();
  addModelFromPositions(viewer, positions, name);
}

/**
 * Adds a model from raw positions via the legacy viewer's loadSTL-equivalent path.
 * We pass positions as a minimal STL-like ArrayBuffer through the viewer's API.
 */
function addModelFromPositions(viewer: LegacyViewer, positions: Float32Array, name: string): void {
  // Build a binary STL buffer from the positions array.
  // Binary STL format: 80-byte header + 4-byte triangle count + (50 bytes per triangle)
  const triCount = positions.length / 9;
  const buffer = new ArrayBuffer(80 + 4 + triCount * 50);
  const view = new DataView(buffer);

  // Triangle count at offset 80
  view.setUint32(80, triCount, true);

  for (let t = 0; t < triCount; t++) {
    const base = t * 9;
    const offset = 84 + t * 50;

    // Compute face normal
    const ax = positions[base + 3] - positions[base];
    const ay = positions[base + 4] - positions[base + 1];
    const az = positions[base + 5] - positions[base + 2];
    const bx = positions[base + 6] - positions[base];
    const by = positions[base + 7] - positions[base + 1];
    const bz = positions[base + 8] - positions[base + 2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;

    // Normal (12 bytes)
    view.setFloat32(offset, nx / len, true);
    view.setFloat32(offset + 4, ny / len, true);
    view.setFloat32(offset + 8, nz / len, true);

    // 3 vertices (36 bytes)
    for (let v = 0; v < 3; v++) {
      const vi = base + v * 3;
      const vo = offset + 12 + v * 12;
      view.setFloat32(vo, positions[vi], true);
      view.setFloat32(vo + 4, positions[vi + 1], true);
      view.setFloat32(vo + 8, positions[vi + 2], true);
    }

    // Attribute byte count (2 bytes)
    view.setUint16(offset + 48, 0, true);
  }

  viewer.loadSTL(buffer, 1);

  // Rename the most recently added object
  const last = viewer.objects[viewer.objects.length - 1];
  if (last) {
    last.mesh.name = name;
  }
}
