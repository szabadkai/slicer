import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import type { Viewer } from './viewer';
import type { SceneObject } from './viewer-core';
import { computeMeshVolume } from './volume';

export function getModelGeometry(viewer: Viewer): THREE.BufferGeometry | null {
  if (viewer.selected.length !== 1) return null;
  const m = viewer.selected[0].mesh;
  const g = m.geometry.clone();
  m.updateMatrixWorld(true);
  g.applyMatrix4(m.matrixWorld);
  g.translate(-(viewer.activePlate.originX || 0), 0, -(viewer.activePlate.originZ || 0));
  g.computeBoundingBox();
  return g;
}

export function getModelMesh(viewer: Viewer): THREE.Mesh | null {
  return viewer.selected.length === 1 ? viewer.selected[0].mesh : null;
}

export function getMergedModelGeometry(viewer: Viewer): THREE.BufferGeometry | null {
  if (viewer.objects.length === 0) return null;
  const gs = viewer.objects.map((o) => {
    const g = o.mesh.geometry.clone();
    o.mesh.updateMatrixWorld(true);
    g.applyMatrix4(o.mesh.matrixWorld);
    g.translate(-(viewer.activePlate.originX || 0), 0, -(viewer.activePlate.originZ || 0));
    return g;
  });
  return gs.length === 1 ? gs[0] : BufferGeometryUtils.mergeGeometries(gs, false);
}

export function getMergedSupportGeometry(viewer: Viewer): THREE.BufferGeometry | null {
  const gs: THREE.BufferGeometry[] = [];
  viewer.objects.forEach((o) => {
    if (o.supportsMesh) {
      const g = o.supportsMesh.geometry.clone();
      o.supportsMesh.updateMatrixWorld(true);
      g.applyMatrix4(o.supportsMesh.matrixWorld);
      g.translate(-(viewer.activePlate.originX || 0), 0, -(viewer.activePlate.originZ || 0));
      gs.push(g);
    }
  });
  if (gs.length === 0) return null;
  return gs.length === 1 ? gs[0] : BufferGeometryUtils.mergeGeometries(gs, false);
}

export function getOverallInfo(viewer: Viewer): {
  count: number;
  triangles: number;
  width: number;
  height: number;
  depth: number;
  modelVolume: number;
  supportVolume: number;
} | null {
  if (viewer.objects.length === 0) return null;
  let tris = 0,
    modelVol = 0,
    supVol = 0;
  const bb = new THREE.Box3();
  viewer.objects.forEach((o) => {
    tris += o.mesh.geometry.attributes.position.count / 3;
    o.mesh.geometry.computeBoundingBox();
    o.mesh.updateMatrixWorld();
    const obb = o.mesh.geometry.boundingBox;
    if (obb) bb.union(obb.clone().applyMatrix4(o.mesh.matrixWorld));
    if (o._cachedLocalVolume === undefined)
      o._cachedLocalVolume = computeMeshVolume(o.mesh.geometry);
    modelVol += (o._cachedLocalVolume ?? 0) * Math.abs(o.mesh.matrixWorld.determinant());
    if (o.supportsMesh) {
      if (o._cachedLocalSupportVolume === undefined)
        o._cachedLocalSupportVolume = computeMeshVolume(o.supportsMesh.geometry);
      o.supportsMesh.updateMatrixWorld();
      supVol +=
        (o._cachedLocalSupportVolume ?? 0) * Math.abs(o.supportsMesh.matrixWorld.determinant());
    }
  });
  const size = new THREE.Vector3();
  bb.getSize(size);
  return {
    triangles: tris,
    width: size.x,
    height: size.y,
    depth: size.z,
    count: viewer.objects.length,
    modelVolume: modelVol,
    supportVolume: supVol,
  };
}

export function checkBounds(viewer: Viewer): { inBounds: boolean } {
  if (!viewer.printer || viewer.objects.length === 0) return { inBounds: true };
  const bb = new THREE.Box3();
  viewer.objects.forEach((o) => {
    o.mesh.geometry.computeBoundingBox();
    o.mesh.updateMatrixWorld();
    const obb = o.mesh.geometry.boundingBox;
    if (obb) bb.union(obb.clone().applyMatrix4(o.mesh.matrixWorld));
  });
  const p = viewer.printer as { buildWidthMM: number; buildDepthMM: number; buildHeightMM: number };
  const ox = viewer.activePlate.originX || 0,
    oz = viewer.activePlate.originZ || 0,
    hw = p.buildWidthMM / 2,
    hd = p.buildDepthMM / 2;
  return {
    inBounds:
      bb.min.x >= ox - hw &&
      bb.max.x <= ox + hw &&
      bb.min.z >= oz - hd &&
      bb.max.z <= oz + hd &&
      bb.max.y <= p.buildHeightMM,
  };
}

export function updateBoundsWarning(viewer: Viewer): void {
  if (!viewer.buildVolumeEdges) return;
  const { inBounds } = checkBounds(viewer);
  viewer.buildVolumeEdges.forEach(({ plate, lines }) => {
    const a = plate === viewer.activePlate;
    (lines.material as THREE.LineBasicMaterial).color.setHex(
      a && !inBounds ? 0xff4444 : a ? 0x0070f3 : 0x888888,
    );
    (lines.material as THREE.LineBasicMaterial).opacity = a && !inBounds ? 0.8 : a ? 0.7 : 0.3;
  });
  updateCollisionWarnings(viewer);
  viewer.requestRender();
}

function updateCollisionWarnings(viewer: Viewer): void {
  const objs = viewer.objects;
  if (!viewer.printer || objs.length === 0) {
    viewer._flaggedIds.clear();
    return;
  }
  const p = viewer.printer as { buildWidthMM: number; buildDepthMM: number; buildHeightMM: number };
  const ox = viewer.activePlate.originX || 0,
    oz = viewer.activePlate.originZ || 0;
  const hw = p.buildWidthMM / 2,
    hd = p.buildDepthMM / 2;
  const boxes: { obj: SceneObject; box: THREE.Box3 }[] = objs.map((obj) => {
    obj.mesh.geometry.computeBoundingBox();
    obj.mesh.updateMatrixWorld(true);
    const box = obj.mesh.geometry.boundingBox
      ? obj.mesh.geometry.boundingBox.clone().applyMatrix4(obj.mesh.matrixWorld)
      : new THREE.Box3();
    return { obj, box };
  });
  const flagged = new Set<string>();
  for (const { obj, box } of boxes) {
    if (
      box.min.x < ox - hw ||
      box.max.x > ox + hw ||
      box.min.z < oz - hd ||
      box.max.z > oz + hd ||
      box.max.y > p.buildHeightMM
    ) {
      flagged.add(obj.id);
    }
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxes[i].box.intersectsBox(boxes[j].box)) {
        flagged.add(boxes[i].obj.id);
        flagged.add(boxes[j].obj.id);
      }
    }
  }
  viewer._flaggedIds = flagged;
  const selectedIds = new Set(viewer.selected.map((o) => o.id));
  for (const { obj } of boxes) {
    const mat = obj.mesh.material as THREE.MeshPhysicalMaterial;
    if (flagged.has(obj.id)) {
      mat.emissive.setHex(0x660000);
    } else {
      mat.emissive.setHex(selectedIds.has(obj.id) ? 0x333333 : 0x000000);
    }
  }
}

// ---- support heatmap ------------------------------------------------------

export function buildSupportHeatmapGeometry(
  targets: SceneObject[],
  overhangAngleDeg: number,
): { geometry: THREE.BufferGeometry | null; area: number; triangleCount: number } | null {
  const geos: THREE.BufferGeometry[] = [];
  for (const obj of targets) {
    if (!obj?.mesh?.geometry) continue;
    const geometry = obj.mesh.geometry.clone();
    obj.mesh.updateMatrixWorld(true);
    geometry.applyMatrix4(obj.mesh.matrixWorld);
    geos.push(geometry);
  }
  if (geos.length === 0) return null;
  const merged = geos.length === 1 ? geos[0] : BufferGeometryUtils.mergeGeometries(geos, false);
  geos.forEach((g) => {
    if (g !== merged) g.dispose();
  });
  if (!merged) return null;

  const source = merged.index ? merged.toNonIndexed() : merged;
  if (source !== merged) merged.dispose();

  const pos = source.attributes.position;
  const overhangThreshold = Math.cos(THREE.MathUtils.degToRad(90 - overhangAngleDeg));
  const heatPositions: number[] = [];
  const heatColors: number[] = [];
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const center = new THREE.Vector3(),
    edge1 = new THREE.Vector3(),
    edge2 = new THREE.Vector3(),
    normal = new THREE.Vector3();
  let supportArea = 0,
    triangleCount = 0;

  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    edge1.subVectors(b, a);
    edge2.subVectors(c, a);
    normal.crossVectors(edge1, edge2);
    const area = normal.length() * 0.5;
    if (area <= 1e-8) continue;
    normal.normalize();
    const downness = -normal.y;
    if (downness <= overhangThreshold) continue;
    center.copy(a).add(b).add(c).divideScalar(3);
    if (center.y <= 0.5) continue;

    const angleDemand = THREE.MathUtils.clamp(
      (downness - overhangThreshold) / (1 - overhangThreshold),
      0,
      1,
    );
    const heightDemand = THREE.MathUtils.clamp(center.y / 50, 0, 1);
    const areaDemand = THREE.MathUtils.clamp(area / 35, 0, 1);
    const demand = THREE.MathUtils.clamp(
      Math.max(angleDemand, angleDemand * 0.82 + heightDemand * 0.12 + areaDemand * 0.06),
      0,
      1,
    );
    const color = supportDemandColor(demand);
    const offset = normal.clone().multiplyScalar(0.04);
    for (const v of [a, b, c]) {
      heatPositions.push(v.x + offset.x, v.y + offset.y, v.z + offset.z);
      heatColors.push(color.r, color.g, color.b);
    }
    supportArea += area;
    triangleCount++;
  }
  source.dispose();
  if (triangleCount === 0) return { geometry: null, area: 0, triangleCount: 0 };

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(heatPositions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(heatColors, 3));
  geometry.computeBoundingSphere();
  return { geometry, area: supportArea, triangleCount };
}

export function showSupportHeatmap(
  viewer: Viewer,
  result: { geometry: THREE.BufferGeometry | null; area: number; triangleCount: number },
): void {
  clearSupportHeatmap(viewer);
  if (!result.geometry) return;
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  viewer._supportHeatmapMesh = new THREE.Mesh(result.geometry, material);
  viewer._supportHeatmapMesh.renderOrder = 900;
  viewer.scene.add(viewer._supportHeatmapMesh);
  viewer.requestRender();
}

export function clearSupportHeatmap(viewer: Viewer): void {
  if (!viewer._supportHeatmapMesh) return;
  viewer.scene.remove(viewer._supportHeatmapMesh);
  viewer._supportHeatmapMesh.geometry?.dispose();
  (viewer._supportHeatmapMesh.material as THREE.Material)?.dispose();
  viewer._supportHeatmapMesh = null;
  viewer.requestRender();
}

function supportDemandColor(demand: number): THREE.Color {
  const low = new THREE.Color(0x00e676);
  const mid = new THREE.Color(0xffea00);
  const hot = new THREE.Color(0xff6d00);
  const high = new THREE.Color(0xff1744);
  if (demand < 0.35) return low.lerp(mid, demand / 0.35);
  if (demand < 0.68) return mid.lerp(hot, (demand - 0.35) / 0.33);
  return hot.lerp(high, (demand - 0.68) / 0.32);
}
