/**
 * Cutter preview rendering and gizmo management for primitive boolean cutting.
 * Runs inside the Viewer's THREE.js context — only imported by viewer.ts.
 */

// eslint-disable-next-line no-restricted-imports -- viewer-level module, THREE access is intentional
import * as THREE from 'three';
import type { ViewerCore } from './viewer-core';

interface CutterEntry {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  wireframe: THREE.LineSegments;
  wireframeMaterial: THREE.LineBasicMaterial;
}

const cutterPreviews = new Map<string, CutterEntry>();
let cutterIdCounter = 0;
let cutterGizmoTarget: string | null = null;
let cutterGizmoDispose: (() => void) | null = null;

export function isCutterGizmoActive(): boolean {
  return cutterGizmoTarget !== null;
}

export function addCutterPreview(viewer: ViewerCore, positions: Float32Array): string {
  const id = `cutter-${++cutterIdCounter}`;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    color: 0xff4444,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = id;
  mesh.renderOrder = 999;

  // Wireframe overlay for better visibility
  const wireframeGeo = new THREE.WireframeGeometry(geometry);
  const wireframeMaterial = new THREE.LineBasicMaterial({
    color: 0xff6666,
    transparent: true,
    opacity: 0.6,
  });
  const wireframe = new THREE.LineSegments(wireframeGeo, wireframeMaterial);
  mesh.add(wireframe);

  viewer.scene.add(mesh);
  cutterPreviews.set(id, { mesh, material, wireframe, wireframeMaterial });
  viewer.requestRender();
  return id;
}

export function updateCutterPreview(
  viewer: ViewerCore,
  id: string,
  position: { x: number; y: number; z: number },
  rotation: { x: number; y: number; z: number },
  scale: { x: number; y: number; z: number },
): void {
  const entry = cutterPreviews.get(id);
  if (!entry) return;

  entry.mesh.position.set(position.x, position.y, position.z);
  entry.mesh.rotation.set(rotation.x, rotation.y, rotation.z, 'XYZ');
  entry.mesh.scale.set(scale.x, scale.y, scale.z);
  viewer.requestRender();
}

export function removeCutterPreview(viewer: ViewerCore, id: string): void {
  const entry = cutterPreviews.get(id);
  if (!entry) return;

  viewer.scene.remove(entry.mesh);
  entry.mesh.geometry.dispose();
  entry.material.dispose();
  entry.wireframe.geometry.dispose();
  entry.wireframeMaterial.dispose();
  cutterPreviews.delete(id);

  if (cutterGizmoTarget === id) {
    clearCutterGizmo(viewer);
  }

  viewer.requestRender();
}

export function setCutterGizmo(
  viewer: ViewerCore,
  id: string,
  mode: 'translate' | 'rotate' | 'scale',
): void {
  const entry = cutterPreviews.get(id);
  if (!entry) return;

  // Detach from existing model selection gizmo
  viewer.transformControl.detach();
  viewer.transformControl.attach(entry.mesh);
  viewer.transformControl.setMode(mode);
  cutterGizmoTarget = id;
  viewer.requestRender();
}

export function clearCutterGizmo(viewer: ViewerCore): void {
  if (cutterGizmoTarget) {
    viewer.transformControl.detach();
    cutterGizmoTarget = null;
  }
  if (cutterGizmoDispose) {
    cutterGizmoDispose();
    cutterGizmoDispose = null;
  }
  viewer.requestRender();
}

export function onCutterGizmoChange(
  viewer: ViewerCore,
  callback: (
    position: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number },
    scale: { x: number; y: number; z: number },
  ) => void,
): () => void {
  const handler = (): void => {
    if (!cutterGizmoTarget) return;
    const entry = cutterPreviews.get(cutterGizmoTarget);
    if (!entry) return;

    const { position, rotation, scale } = entry.mesh;
    callback(
      { x: position.x, y: position.y, z: position.z },
      { x: rotation.x, y: rotation.y, z: rotation.z },
      { x: scale.x, y: scale.y, z: scale.z },
    );
  };

  viewer.transformControl.addEventListener('change', handler);
  cutterGizmoDispose = () => {
    viewer.transformControl.removeEventListener('change', handler);
  };

  return () => {
    viewer.transformControl.removeEventListener('change', handler);
    if (cutterGizmoDispose === handler) cutterGizmoDispose = null;
  };
}

export function getModelPositions(viewer: ViewerCore, id: string): Float32Array | null {
  const obj = viewer.objects.find((o) => o.id === id);
  if (!obj) return null;

  const geometry = obj.mesh.geometry as THREE.BufferGeometry;
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!posAttr) return null;

  // Apply world transform to get positions in world space
  obj.mesh.updateMatrixWorld(true);
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const srcAttr = source.getAttribute('position') as THREE.BufferAttribute;
  const positions = new Float32Array(srcAttr.count * 3);

  const vec = new THREE.Vector3();
  for (let i = 0; i < srcAttr.count; i++) {
    vec.set(srcAttr.getX(i), srcAttr.getY(i), srcAttr.getZ(i));
    vec.applyMatrix4(obj.mesh.matrixWorld);
    positions[i * 3] = vec.x;
    positions[i * 3 + 1] = vec.y;
    positions[i * 3 + 2] = vec.z;
  }

  if (geometry.index && source !== geometry) source.dispose();
  return positions;
}
