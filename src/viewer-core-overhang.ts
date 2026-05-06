// ─── Overhang overlay management for ViewerCore ─────────────
// Shows/clears a color-coded overhang overlay on the 3D scene.
// Red = unsupported overhang, green = covered by support contact.

import * as THREE from 'three';
import type { ViewerCore } from './viewer-core';
import {
  buildOverhangOverlayData,
  type SupportContact,
} from './features/support-generation/overhang-overlay';
import type { OverhangParams } from './features/support-generation/detect';

export function showOverhangOverlay(
  core: ViewerCore,
  objectId: string,
  supportContacts: SupportContact[],
  overhangParams?: Partial<OverhangParams>,
  coverageRadius?: number,
): void {
  clearOverhangOverlay(core);
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

  const triangleCount = Math.floor(pos.count / 3);
  const positions = (pos as THREE.BufferAttribute).array as Float32Array;

  const result = buildOverhangOverlayData(
    positions,
    triangleCount,
    supportContacts,
    overhangParams,
    coverageRadius,
  );

  nonIndexed.dispose();
  if (!result) return;

  const overlayGeo = new THREE.BufferGeometry();
  overlayGeo.setAttribute('position', new THREE.Float32BufferAttribute(result.positions, 3));
  overlayGeo.setAttribute('color', new THREE.Float32BufferAttribute(result.colors, 3));
  overlayGeo.computeBoundingSphere();

  core._overhangOverlayMaterial ??= new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.45,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  core._overhangOverlayMesh = new THREE.Mesh(overlayGeo, core._overhangOverlayMaterial);
  core._overhangOverlayMesh.renderOrder = 998;
  core.scene.add(core._overhangOverlayMesh);
  core.requestRender();
}

export function clearOverhangOverlay(core: ViewerCore): void {
  if (core._overhangOverlayMesh) {
    core.scene.remove(core._overhangOverlayMesh);
    core._overhangOverlayMesh.geometry.dispose();
    core._overhangOverlayMesh = null;
  }
  core.requestRender();
}
