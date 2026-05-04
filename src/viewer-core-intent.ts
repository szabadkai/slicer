// ─── Intent overlay & intent paint logic extracted from ViewerCore ────────
// All functions take the viewer core instance as first parameter.

import * as THREE from 'three';
import type { ViewerCore, SceneObject } from './viewer-core';

const INTENT_OVERLAY_COLORS: Record<number, THREE.Color> = {
  1: new THREE.Color(0x3b82f6), // cosmetic — blue
  2: new THREE.Color(0x6b7280), // hidden — gray
  3: new THREE.Color(0xef4444), // reliability-critical — red
  4: new THREE.Color(0xf59e0b), // removal-sensitive — amber
};

export function showIntentOverlay(
  core: ViewerCore,
  objectId: string,
  intentBuffer: Uint8Array,
): void {
  clearIntentOverlay(core);
  const obj = core.objects.find((o) => o.id === objectId);
  if (!obj) return;

  const srcGeo = obj.mesh.geometry;
  const nonIndexed = srcGeo.index ? srcGeo.toNonIndexed() : srcGeo.clone();
  nonIndexed.applyMatrix4(obj.mesh.matrixWorld);

  const pos = nonIndexed.attributes.position;
  if (!pos) {
    nonIndexed.dispose();
    return;
  }

  const triCount = Math.floor(pos.count / 3);
  const positions: number[] = [];
  const colors: number[] = [];
  const OFFSET = 0.05;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const e1 = new THREE.Vector3(),
    e2 = new THREE.Vector3(),
    n = new THREE.Vector3();
  const colorMap = INTENT_OVERLAY_COLORS;

  for (let tri = 0; tri < triCount && tri < intentBuffer.length; tri++) {
    const byte = intentBuffer[tri];
    if (byte === 0) continue;
    const intentId = byte & 0b111;
    const color = colorMap[intentId];
    if (!color) continue;

    const i = tri * 3;
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);

    e1.subVectors(b, a);
    e2.subVectors(c, a);
    n.crossVectors(e1, e2);
    const len = n.length();
    if (len < 1e-8) continue;
    n.divideScalar(len);

    const ox = n.x * OFFSET,
      oy = n.y * OFFSET,
      oz = n.z * OFFSET;
    for (const v of [a, b, c]) {
      positions.push(v.x + ox, v.y + oy, v.z + oz);
      colors.push(color.r, color.g, color.b);
    }
  }

  nonIndexed.dispose();
  if (positions.length === 0) return;

  const overlayGeo = new THREE.BufferGeometry();
  overlayGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  overlayGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  overlayGeo.computeBoundingSphere();

  core._intentOverlayMaterial ??= new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  core._intentOverlayMesh = new THREE.Mesh(overlayGeo, core._intentOverlayMaterial);
  core._intentOverlayMesh.renderOrder = 999;
  core.scene.add(core._intentOverlayMesh);
  core.requestRender();
}

export function clearIntentOverlay(core: ViewerCore): void {
  if (core._intentOverlayMesh) {
    core.scene.remove(core._intentOverlayMesh);
    core._intentOverlayMesh.geometry.dispose();
    core._intentOverlayMesh = null;
  }
  core.requestRender();
}

export function setIntentPaintMode(core: ViewerCore, enabled: boolean): void {
  core.intentPaintMode = enabled;
  core.canvas.classList.toggle('intent-paint-mode', enabled);
  core.controls.enabled = !enabled;
  if (!enabled && core.paintPreview) core.paintPreview.visible = false;
}

export function handleIntentPaint(core: ViewerCore, e: PointerEvent): void {
  if (!core.intentPaintMode) return;
  const rect = core.canvas.getBoundingClientRect();
  core.raycaster.setFromCamera(
    new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    ),
    core.camera,
  );
  const targets = core.selected.length > 0 ? core.selected : core.objects;
  const meshes = targets.map((o: SceneObject) => o.mesh);
  const intersects = core.raycaster.intersectObjects(meshes, false);
  const hit = intersects[0];
  if (!hit?.face) return;

  const object = targets.find((o: SceneObject) => o.mesh === hit.object);
  if (!object) return;

  const faceIndex = hit.faceIndex;
  if (faceIndex === undefined || faceIndex === null) return;

  const hitPoint = hit.point.clone();
  const geo = object.mesh.geometry;
  const pos = geo.attributes.position;
  if (!pos) return;

  const triCount = geo.index ? Math.floor(geo.index.count / 3) : Math.floor(pos.count / 3);

  if (!object.intentBuffer || object.intentBuffer.length !== triCount) {
    object.intentBuffer = new Uint8Array(triCount);
  }

  const brushRadius = core.intentBrushRadiusMM;
  const affectedFaces: number[] = [];
  const worldMatrix = object.mesh.matrixWorld;
  const v = new THREE.Vector3();

  if (brushRadius <= 0) {
    affectedFaces.push(faceIndex);
  } else {
    for (let tri = 0; tri < triCount; tri++) {
      let cx = 0,
        cy = 0,
        cz = 0;
      if (geo.index) {
        for (let vi = 0; vi < 3; vi++) {
          const idx = geo.index.getX(tri * 3 + vi);
          v.fromBufferAttribute(pos, idx);
          v.applyMatrix4(worldMatrix);
          cx += v.x;
          cy += v.y;
          cz += v.z;
        }
      } else {
        for (let vi = 0; vi < 3; vi++) {
          v.fromBufferAttribute(pos, tri * 3 + vi);
          v.applyMatrix4(worldMatrix);
          cx += v.x;
          cy += v.y;
          cz += v.z;
        }
      }
      cx /= 3;
      cy /= 3;
      cz /= 3;

      const dx = cx - hitPoint.x;
      const dy = cy - hitPoint.y;
      const dz = cz - hitPoint.z;
      if (dx * dx + dy * dy + dz * dz <= brushRadius * brushRadius) {
        affectedFaces.push(tri);
      }
    }
  }

  if (affectedFaces.length === 0) return;

  core.canvas.dispatchEvent(
    new CustomEvent('intent-paint-faces', {
      detail: { objectId: object.id, faceIndices: affectedFaces },
    }),
  );
}
