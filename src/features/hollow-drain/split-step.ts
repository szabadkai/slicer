// ─── Split step for hollow-drain panel ────────────────────────
// Model splitting with preview plane and pin connectors.

/* eslint-disable no-restricted-imports */
import * as THREE from 'three';
import type { AppContext } from '@core/types';
import { listen } from '@features/app-shell/utils';
import { splitMesh } from './splitter';
import { getMesh, getGeometry, getScene, addModel } from './viewer-helpers';

export function mountSplitStep(ctx: AppContext): void {
  const { viewer } = ctx;

  const splitAxis = document.getElementById('split-axis') as HTMLSelectElement | null;
  const splitPos = document.getElementById('split-position') as HTMLInputElement | null;
  const splitPosVal = document.getElementById('split-position-val');
  const splitConnector = document.getElementById('split-connector') as HTMLSelectElement | null;
  const splitPinOptions = document.getElementById('split-pin-options');
  const splitPinDiam = document.getElementById('split-pin-diameter') as HTMLInputElement | null;
  const splitPinCount = document.getElementById('split-pin-count') as HTMLInputElement | null;
  const splitPreview = document.getElementById('split-preview') as HTMLInputElement | null;
  const splitApplyBtn = document.getElementById('split-apply-btn');
  const splitBadge = document.getElementById('hollow-split-badge');

  let splitPlaneMesh: THREE.Mesh | null = null;

  listen(splitPos, 'input', () => {
    if (splitPosVal && splitPos) splitPosVal.textContent = splitPos.value + '%';
    if (splitPreview?.checked) updateSplitPreview();
  });

  listen(splitConnector, 'change', () => {
    const usePins = splitConnector?.value === 'pins';
    if (splitPinOptions) {
      splitPinOptions.style.opacity = usePins ? '1' : '0.5';
      splitPinOptions.style.pointerEvents = usePins ? 'auto' : 'none';
    }
    if (splitPinDiam) splitPinDiam.disabled = !usePins;
    if (splitPinCount) splitPinCount.disabled = !usePins;
  });

  listen(splitPreview, 'change', () => {
    if (splitPreview?.checked) updateSplitPreview();
    else clearSplitPreview();
  });

  listen(splitApplyBtn, 'click', () => {
    void applySplit();
  });

  function getSplitPositionMM(): number {
    const mesh = getMesh(viewer);
    if (!mesh) return 0;
    const bb = new THREE.Box3().setFromObject(mesh);
    const axis = (splitAxis?.value ?? 'z') as 'x' | 'y' | 'z';
    const pct = parseFloat(splitPos?.value ?? '50') / 100;
    return bb.min[axis] + (bb.max[axis] - bb.min[axis]) * pct;
  }

  function updateSplitPreview(): void {
    clearSplitPreview();
    const mesh = getMesh(viewer);
    if (!mesh) return;
    const bb = new THREE.Box3().setFromObject(mesh);
    const axis = (splitAxis?.value ?? 'z') as 'x' | 'y' | 'z';
    const positionMM = getSplitPositionMM();

    const size = new THREE.Vector3();
    bb.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) * 1.5;
    const planeGeo = new THREE.PlaneGeometry(maxDim, maxDim);

    if (axis === 'x') planeGeo.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2));
    else if (axis === 'z') planeGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));

    const center = new THREE.Vector3(
      (bb.min.x + bb.max.x) / 2,
      (bb.min.y + bb.max.y) / 2,
      (bb.min.z + bb.max.z) / 2,
    );
    center[axis] = positionMM;

    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x0070f3,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    splitPlaneMesh = new THREE.Mesh(planeGeo, planeMat);
    splitPlaneMesh.position.copy(center);
    getScene(viewer).add(splitPlaneMesh);
    viewer.requestRender();
  }

  function clearSplitPreview(): void {
    if (splitPlaneMesh) {
      getScene(viewer).remove(splitPlaneMesh);
      splitPlaneMesh.geometry.dispose();
      splitPlaneMesh = null;
      viewer.requestRender();
    }
  }

  async function applySplit(): Promise<void> {
    if (!viewer.selected[0]) return;
    const geo = getGeometry(viewer);
    if (!geo) return;

    const axis = (splitAxis?.value ?? 'z') as 'x' | 'y' | 'z';
    const positionMM = getSplitPositionMM();
    const usePins = splitConnector?.value === 'pins';
    const pinCount = parseInt(splitPinCount?.value ?? '2', 10);
    const pinDiam = parseFloat(splitPinDiam?.value ?? '3');

    ctx.showProgress('Splitting model…');
    await yieldThread();

    try {
      const result = splitMesh(geo, axis, positionMM, usePins, pinCount, pinDiam);
      viewer.removeSelected();
      addModel(viewer, result.part1);
      addModel(viewer, result.part2);
      clearSplitPreview();
      if (splitBadge) {
        splitBadge.textContent = '✓';
        splitBadge.className = 'step-badge step-badge-done';
      }
      viewer.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
      ctx.updateEstimate();
      ctx.scheduleProjectAutosave();
    } finally {
      ctx.hideProgress();
    }
  }
}

async function yieldThread(): Promise<void> {
  return new Promise((r) => setTimeout(r, 10));
}
