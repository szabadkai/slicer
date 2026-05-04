/**
 * Pick mode — surface-picking interaction with cursor preview.
 * Extracted from hollow-drain panel. Handles raycasting on hover
 * and click-to-pick on mesh surfaces.
 */
/* eslint-disable no-restricted-imports */
import * as THREE from 'three';

export interface PickModeCallbacks {
  getMesh(): THREE.Mesh | null;
  getCamera(): THREE.Camera;
  getScene(): THREE.Scene;
  getDiameter(): number;
  onPick(position: THREE.Vector3, normal: THREE.Vector3): void;
  requestRender(): void;
}

export interface PickMode {
  active: boolean;
  handleMouseMove(e: MouseEvent): void;
  handleClick(e: MouseEvent): void;
  clearCursor(): void;
}

export function createPickMode(canvas: HTMLCanvasElement, callbacks: PickModeCallbacks): PickMode {
  let cursorMesh: THREE.Mesh | null = null;

  function clearCursor(): void {
    if (cursorMesh) {
      callbacks.getScene().remove(cursorMesh);
      cursorMesh = null;
      callbacks.requestRender();
    }
  }

  const mode: PickMode = {
    active: false,
    clearCursor,

    handleMouseMove(e: MouseEvent): void {
      if (!mode.active) return;
      const mesh = callbacks.getMesh();
      if (!mesh) return;

      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );

      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, callbacks.getCamera());
      const hits = ray.intersectObject(mesh);
      if (hits.length > 0) {
        const hit = hits[0];
        if (!cursorMesh) {
          const d = callbacks.getDiameter();
          const cursorGeo = new THREE.RingGeometry((d / 2) * 0.6, d / 2, 24);
          const cursorMat = new THREE.MeshBasicMaterial({
            color: 0x00e5ff,
            side: THREE.DoubleSide,
            depthWrite: false,
            transparent: true,
            opacity: 0.8,
          });
          cursorMesh = new THREE.Mesh(cursorGeo, cursorMat);
          cursorMesh.renderOrder = 20;
          callbacks.getScene().add(cursorMesh);
        }
        cursorMesh.position.copy(hit.point);
        if (!hit.face) return;
        const norm = hit.face.normal.clone().transformDirection(mesh.matrixWorld).normalize();
        cursorMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), norm);
        callbacks.requestRender();
      }
    },

    handleClick(e: MouseEvent): void {
      if (!mode.active) return;
      const mesh = callbacks.getMesh();
      if (!mesh) return;

      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );

      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, callbacks.getCamera());
      const hits = ray.intersectObject(mesh);
      if (hits.length > 0) {
        const hit = hits[0];
        if (!hit.face) return;
        const norm = hit.face.normal.clone().transformDirection(mesh.matrixWorld).normalize();
        callbacks.onPick(hit.point.clone(), norm);
      }
    },
  };

  return mode;
}
