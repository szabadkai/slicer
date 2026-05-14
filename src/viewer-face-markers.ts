/**
 * Face marker delegate — significant face markers and highlight management.
 * Called by Viewer class methods; keeps viewer.ts under the LOC limit.
 */

import * as THREE from 'three';
import type { Viewer } from './viewer';
import {
  addSignificantFaceMarker as addMarker,
  clearSignificantFaceMarkers as clearMarkers,
} from './viewer-scene';

export function addSignificantFaceMarker(
  viewer: Viewer,
  centroid: THREE.Vector3,
  normal: THREE.Vector3,
  area: number,
  color: number,
  index: number,
  options?: Record<string, unknown>,
): void {
  addMarker(
    viewer.scene,
    viewer._significantFaceMarkers,
    centroid,
    normal,
    area,
    color,
    index,
    options,
  );
}

export function clearSignificantFaceMarkers(viewer: Viewer): void {
  clearMarkers(viewer.scene, viewer._significantFaceMarkers);
}

export function highlightSignificantFaces(
  viewer: Viewer,
  faces: { centroid: THREE.Vector3; normal: THREE.Vector3; area: number }[],
): void {
  const colors = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0x95e1d3, 0xf38181, 0xaa96da];
  faces.forEach((f, i) =>
    addSignificantFaceMarker(
      viewer,
      f.centroid,
      f.normal,
      f.area,
      colors[i % colors.length],
      i + 1,
    ),
  );
}

export function clearSignificantFaceHighlights(viewer: Viewer): void {
  if (viewer.significantFaceHighlights) {
    viewer.significantFaceHighlights.forEach((m) => {
      if (m.parent === viewer.scene) viewer.scene.remove(m);
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    });
    viewer.significantFaceHighlights = null;
  }
  viewer.requestRender();
}
