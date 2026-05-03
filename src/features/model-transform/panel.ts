/**
 * Transform panel — move / scale / rotate inputs + mode toggles.
 */
import type { AppContext } from '@core/types';
import { listen } from '@features/app-shell/utils';

export function mountTransformPanel(ctx: AppContext): void {
  const { viewer } = ctx;
  const panel = document.getElementById('transform-panel');
  if (!panel) return;

  // Mode buttons
  const modeBtns = panel.querySelectorAll<HTMLElement>('.mode-btn');
  const fieldSets: Record<string, HTMLElement | null> = {
    translate: document.getElementById('transform-move-fields'),
    scale: document.getElementById('transform-scale-fields'),
    rotate: document.getElementById('transform-rotate-fields'),
  };

  modeBtns.forEach((btn) => {
    listen(btn, 'click', () => {
      modeBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode ?? 'translate';
      Object.values(fieldSets).forEach((f) => { if (f) f.hidden = true; });
      const active = fieldSets[mode];
      if (active) active.hidden = false;
      viewer.setTransformMode(mode);
    });
  });

  // Input refs
  const moveX = document.getElementById('move-x') as HTMLInputElement | null;
  const moveY = document.getElementById('move-y') as HTMLInputElement | null;
  const moveZ = document.getElementById('move-z') as HTMLInputElement | null;
  const scaleX = document.getElementById('scale-x') as HTMLInputElement | null;
  const scaleY = document.getElementById('scale-y') as HTMLInputElement | null;
  const scaleZ = document.getElementById('scale-z') as HTMLInputElement | null;
  const sizeX = document.getElementById('size-x') as HTMLInputElement | null;
  const sizeY = document.getElementById('size-y') as HTMLInputElement | null;
  const sizeZ = document.getElementById('size-z') as HTMLInputElement | null;
  const rotateX = document.getElementById('rotate-x') as HTMLInputElement | null;
  const rotateY = document.getElementById('rotate-y') as HTMLInputElement | null;
  const rotateZ = document.getElementById('rotate-z') as HTMLInputElement | null;
  const uniformScale = document.getElementById('uniform-scale') as HTMLInputElement | null;

  function updateTransformInputs(): void {
    if (viewer.selected.length === 0) return;
    const pos = viewer.selected.length === 1
      ? viewer.getSelectionWorldCenter()
      : viewer.getSelectionWorldCenter();
    if (pos) {
      if (moveX) moveX.value = String(Math.round(pos.x * 100) / 100);
      if (moveY) moveY.value = String(Math.round(pos.y * 100) / 100);
      if (moveZ) moveZ.value = String(Math.round(pos.z * 100) / 100);
    }
    if (scaleX) scaleX.value = '100';
    if (scaleY) scaleY.value = '100';
    if (scaleZ) scaleZ.value = '100';
    const size = viewer.getSelectionWorldSize();
    if (size) {
      if (sizeX) sizeX.value = String(Math.round(size.x * 100) / 100);
      if (sizeY) sizeY.value = String(Math.round(size.y * 100) / 100);
      if (sizeZ) sizeZ.value = String(Math.round(size.z * 100) / 100);
    }
    if (viewer.selected.length === 1) {
      const rot = viewer.selected[0].mesh.rotation;
      const r2d = 180 / Math.PI;
      if (rotateX) rotateX.value = String(Math.round(rot.x * r2d));
      if (rotateY) rotateY.value = String(Math.round(rot.y * r2d));
      if (rotateZ) rotateZ.value = String(Math.round(rot.z * r2d));
    } else {
      if (rotateX) rotateX.value = '0';
      if (rotateY) rotateY.value = '0';
      if (rotateZ) rotateZ.value = '0';
    }
  }

  // Move inputs
  function applyMove(): void {
    if (viewer.selected.length === 0) return;
    viewer.translateSelectionTo({
      x: parseFloat(moveX?.value ?? '0') || 0,
      y: parseFloat(moveY?.value ?? '0') || 0,
      z: parseFloat(moveZ?.value ?? '0') || 0,
    });
    updateTransformInputs();
  }
  [moveX, moveY, moveZ].forEach((el) => listen(el, 'change', applyMove));

  // Scale inputs
  function applyScale(axis: 'x' | 'y' | 'z'): void {
    if (viewer.selected.length === 0) return;
    const sx = (parseFloat(scaleX?.value ?? '100') || 100) / 100;
    const sy = (parseFloat(scaleY?.value ?? '100') || 100) / 100;
    const sz = (parseFloat(scaleZ?.value ?? '100') || 100) / 100;
    if (uniformScale?.checked) {
      const val = axis === 'x' ? sx : axis === 'y' ? sy : sz;
      if (scaleX) scaleX.value = String(Math.round(val * 100));
      if (scaleY) scaleY.value = String(Math.round(val * 100));
      if (scaleZ) scaleZ.value = String(Math.round(val * 100));
      viewer.scaleSelectionBy({ x: val, y: val, z: val });
    } else {
      viewer.scaleSelectionBy({ x: sx, y: sy, z: sz });
    }
    updateTransformInputs();
  }
  listen(scaleX, 'change', () => applyScale('x'));
  listen(scaleY, 'change', () => applyScale('y'));
  listen(scaleZ, 'change', () => applyScale('z'));

  // Size inputs
  function applySize(axis: 'x' | 'y' | 'z'): void {
    if (viewer.selected.length === 0) return;
    const currentSize = viewer.getSelectionWorldSize();
    if (!currentSize || currentSize.x <= 0 || currentSize.y <= 0 || currentSize.z <= 0) return;
    const tx = parseFloat(sizeX?.value ?? '0');
    const ty = parseFloat(sizeY?.value ?? '0');
    const tz = parseFloat(sizeZ?.value ?? '0');
    if (uniformScale?.checked) {
      const cur = axis === 'x' ? currentSize.x : axis === 'y' ? currentSize.y : currentSize.z;
      const tgt = axis === 'x' ? tx : axis === 'y' ? ty : tz;
      if (!Number.isFinite(tgt) || tgt <= 0 || cur <= 0) return;
      const f = tgt / cur;
      viewer.scaleSelectionBy({ x: f, y: f, z: f });
    } else {
      viewer.scaleSelectionBy({
        x: Number.isFinite(tx) && tx > 0 ? tx / currentSize.x : 1,
        y: Number.isFinite(ty) && ty > 0 ? ty / currentSize.y : 1,
        z: Number.isFinite(tz) && tz > 0 ? tz / currentSize.z : 1,
      });
    }
    updateTransformInputs();
  }
  listen(sizeX, 'change', () => applySize('x'));
  listen(sizeY, 'change', () => applySize('y'));
  listen(sizeZ, 'change', () => applySize('z'));

  // Rotation inputs
  function applyRotation(): void {
    if (viewer.selected.length === 0) return;
    const d2r = Math.PI / 180;
    viewer.rotateSelectionBy({
      x: (parseFloat(rotateX?.value ?? '0') || 0) * d2r,
      y: (parseFloat(rotateY?.value ?? '0') || 0) * d2r,
      z: (parseFloat(rotateZ?.value ?? '0') || 0) * d2r,
    });
    updateTransformInputs();
  }
  [rotateX, rotateY, rotateZ].forEach((el) => listen(el, 'change', applyRotation));

  // Sync on selection change
  listen(viewer.canvas, 'selection-changed', () => {
    if (viewer.selected.length > 0) updateTransformInputs();
  });

  // Edit actions
  listen(document.getElementById('duplicate-btn'), 'click', () => viewer.duplicateSelected());
  listen(document.getElementById('delete-btn'), 'click', () => viewer.removeSelected());
  listen(document.getElementById('clear-btn'), 'click', () => viewer.clearPlate());
  listen(document.getElementById('fill-btn'), 'click', () => {
    if (!viewer.fillPlatform()) {
      // Platform may be too small
    }
  });
  listen(document.getElementById('arrange-btn'), 'click', () => viewer.autoArrange());
}
