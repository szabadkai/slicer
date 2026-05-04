import * as THREE from 'three';
import type { Viewer } from './viewer';
import type { SceneObject, PlateState } from './viewer-core';
import {
  gaArrange,
  computeFillLayout,
  computeConvexHull,
  distributeAcrossPlates as distributeLayout,
  type BodyFootprint,
  type ArrangePlacement,
  type Point2D,
} from './viewer-arrange';

export function setActivePlate(viewer: Viewer, plate: PlateState): void {
  if (!plate || plate === viewer.activePlate) return;
  viewer._saveActivePlateSelection();
  viewer.transformControl.detach();
  viewer.activePlate = plate;
  viewer.objects = plate.objects;
  const ids = new Set(plate.selectedIds || []);
  viewer.selected = viewer.objects.filter((o) => ids.has(o.id));
  viewer._attachTransformControls();
  viewer._updateSelectionVisuals();
  viewer._setupGrid();
  viewer.canvas.dispatchEvent(new CustomEvent('selection-changed'));
  viewer.canvas.dispatchEvent(new CustomEvent('plate-changed', { detail: { plate } }));
  viewer.canvas.dispatchEvent(new CustomEvent('mesh-changed', { detail: { preserveSlice: true } }));
  viewer.requestRender();
}

export function bindInitialPlate(viewer: Viewer, plate: PlateState): void {
  viewer.activePlate = plate;
  viewer.plates = [plate];
  viewer.objects = plate.objects;
  viewer.selected = [];
  viewer._setupGrid();
}

export function setPlates(viewer: Viewer, plates: PlateState[]): void {
  viewer.plates = plates;
  viewer._setupGrid();
  plates.forEach((p) => p.objects.forEach((o) => viewer._setObjectSceneVisible(o, true)));
  viewer._updateSelectionVisuals();
}

export function frameAllPlates(viewer: Viewer): void {
  if (!viewer.printer || !viewer.plates?.length) return;
  const bb = new THREE.Box3();
  const p = viewer.printer as {
    buildWidthMM: number;
    buildDepthMM: number;
    buildHeightMM: number;
  };
  viewer.plates.forEach((pl) => {
    const hw = p.buildWidthMM / 2,
      hd = p.buildDepthMM / 2;
    bb.expandByPoint(new THREE.Vector3((pl.originX || 0) - hw, 0, (pl.originZ || 0) - hd));
    bb.expandByPoint(
      new THREE.Vector3((pl.originX || 0) + hw, p.buildHeightMM, (pl.originZ || 0) + hd),
    );
  });
  const c = new THREE.Vector3(),
    s = new THREE.Vector3();
  bb.getCenter(c);
  bb.getSize(s);
  const m = Math.max(s.x, s.z, s.y);
  viewer.camera.position.set(c.x + m * 0.75, Math.max(m * 0.7, p.buildHeightMM), c.z + m * 0.75);
  viewer.controls.target.copy(c);
  viewer.controls.update();
  viewer.requestRender();
}

export function moveSelectedToPlate(
  viewer: Viewer,
  targetPlate: PlateState,
  { selectMoved = true } = {},
): SceneObject[] {
  if (!targetPlate || targetPlate === viewer.activePlate || viewer.selected.length === 0) return [];
  viewer._saveMultiPlateUndoState();
  const ids = new Set(viewer.selected.map((o) => o.id));
  const moving = viewer.objects.filter((o) => ids.has(o.id));
  viewer.objects = viewer.objects.filter((o) => !ids.has(o.id));
  viewer.activePlate.objects = viewer.objects;
  viewer.activePlate.selectedIds = [];
  const dx = (targetPlate.originX || 0) - (viewer.activePlate.originX || 0);
  const dz = (targetPlate.originZ || 0) - (viewer.activePlate.originZ || 0);
  moving.forEach((o) => {
    o.mesh.position.x += dx;
    o.mesh.position.z += dz;
    if (o.supportsMesh) {
      o.supportsMesh.position.x += dx;
      o.supportsMesh.position.z += dz;
    }
  });
  targetPlate.objects.push(...moving);
  targetPlate.selectedIds = selectMoved ? moving.map((o) => o.id) : [];
  viewer.selected = [];
  viewer.transformControl.detach();
  viewer.canvas.dispatchEvent(new CustomEvent('selection-changed'));
  viewer.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  return moving;
}

export function replaceActiveObjects(viewer: Viewer, objects: SceneObject[]): void {
  viewer.transformControl.detach();
  viewer.objects.forEach((o) => viewer._setObjectSceneVisible(o, false));
  viewer.objects = objects;
  viewer.activePlate.objects = objects;
  viewer.selected = [];
  viewer.activePlate.selectedIds = [];
  viewer.objects.forEach((o) => viewer._setObjectSceneVisible(o, true));
  viewer.canvas.dispatchEvent(new CustomEvent('selection-changed'));
  viewer.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  viewer.requestRender();
}

export function duplicateObjectsForPlate(viewer: Viewer, objects?: SceneObject[]): SceneObject[] {
  const objs = objects ?? viewer.objects;
  return objs.map((src) => {
    const mesh = new THREE.Mesh(
      src.mesh.geometry.clone(),
      (src.mesh.material as THREE.Material).clone(),
    );
    mesh.position.copy(src.mesh.position);
    mesh.rotation.copy(src.mesh.rotation);
    mesh.scale.copy(src.mesh.scale);
    const id = 'obj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    mesh.userData.id = id;
    mesh.updateMatrixWorld(true);
    let supportsMesh: THREE.Mesh | null = null;
    if (src.supportsMesh) {
      supportsMesh = new THREE.Mesh(
        src.supportsMesh.geometry.clone(),
        (src.supportsMesh.material as THREE.Material).clone(),
      );
      supportsMesh.position.copy(src.supportsMesh.position);
      supportsMesh.rotation.copy(src.supportsMesh.rotation);
      supportsMesh.scale.copy(src.supportsMesh.scale);
      supportsMesh.updateMatrixWorld(true);
    }
    return {
      id,
      mesh,
      supportsMesh,
      elevation: src.elevation,
      materialPreset: src.materialPreset || {},
    } as SceneObject;
  });
}

export function reassignObjectsToPlates(viewer: Viewer): void {
  if (
    viewer.selected.length === 0 ||
    !viewer.plates ||
    viewer.plates.length <= 1 ||
    !viewer.printer
  )
    return;
  const spec = viewer.printer as { buildWidthMM: number; buildDepthMM: number };
  const hw = spec.buildWidthMM / 2,
    hd = spec.buildDepthMM / 2;
  let movedTo: PlateState | null = null;
  viewer.selected.forEach((sel) => {
    const pos = sel.mesh.position;
    const cur = viewer.getPlateForObject(sel.id);
    let bestPlate: PlateState | null = null,
      bestDist = Infinity;
    for (const pl of viewer.plates) {
      const ox = pl.originX || 0,
        oz = pl.originZ || 0;
      if (pos.x >= ox - hw && pos.x <= ox + hw && pos.z >= oz - hd && pos.z <= oz + hd) {
        const d = Math.hypot(pos.x - ox, pos.z - oz);
        if (d < bestDist) {
          bestDist = d;
          bestPlate = pl;
        }
      }
    }
    if (!bestPlate) {
      for (const pl of viewer.plates) {
        const d = Math.hypot(pos.x - (pl.originX || 0), pos.z - (pl.originZ || 0));
        if (d < bestDist) {
          bestDist = d;
          bestPlate = pl;
        }
      }
    }
    if (bestPlate && bestPlate !== cur) {
      moveObjectToPlate(viewer, sel, bestPlate);
      movedTo = bestPlate;
    }
  });
  if (movedTo) {
    setActivePlate(viewer, movedTo);
    viewer.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  } else viewer.canvas.dispatchEvent(new CustomEvent('selection-changed'));
}

function moveObjectToPlate(viewer: Viewer, obj: SceneObject, target: PlateState): void {
  const cur = viewer.getPlateForObject(obj.id);
  if (!cur || cur === target) return;
  const idx = cur.objects.indexOf(obj);
  if (idx !== -1) cur.objects.splice(idx, 1);
  target.objects.push(obj);
  cur.slicedLayers = null;
  cur.slicedVolumes = null;
  cur.dirty = true;
  target.slicedLayers = null;
  target.slicedVolumes = null;
  target.dirty = true;
}

// ---- arrangement ----------------------------------------------------------

export function autoArrange(viewer: Viewer, padding = 0.5, elevation = 10): boolean {
  if (!viewer.printer) return false;
  if (viewer.plates.length > 1) {
    return distributeAcrossPlates(viewer, viewer.plates, padding, elevation);
  }
  if (viewer.objects.length === 0) return false;
  viewer._saveUndoState();
  const p = viewer.printer as { buildWidthMM: number; buildDepthMM: number };
  const uw = p.buildWidthMM,
    ud = p.buildDepthMM;
  if (uw <= 0 || ud <= 0) return false;
  const ox = viewer.activePlate.originX || 0,
    oz = viewer.activePlate.originZ || 0;
  const bodies = computeBodyFootprints(viewer.objects);
  const placements = gaArrange(bodies, uw, ud, { padding });
  if (placements.length === 0) return false;
  applyArrangePlacements(placements, viewer.objects, ox, oz, elevation);
  if (viewer.selected.length > 1) viewer._positionSelectionPivot();
  else viewer._attachTransformControls();
  viewer.canvas.dispatchEvent(new CustomEvent('selection-changed'));
  viewer.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  return true;
}

export function fillPlatform(viewer: Viewer): boolean {
  if (viewer.selected.length !== 1 || !viewer.printer) return false;
  viewer._saveUndoState();
  viewer._bakeTransform();
  const sel = viewer.selected[0];
  sel.mesh.geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  const fbb = sel.mesh.geometry.boundingBox;
  if (fbb) fbb.getSize(size);
  const p = viewer.printer as { buildWidthMM: number; buildDepthMM: number };
  const layout = computeFillLayout(size.x, size.z, p.buildWidthMM, p.buildDepthMM);
  if (!layout) return false;
  const ox = viewer.activePlate.originX || 0,
    oz = viewer.activePlate.originZ || 0;
  const elev = sel.elevation,
    mat = sel.mesh.material as THREE.Material,
    preset = sel.materialPreset;
  const tpl = sel.mesh.geometry.clone();
  tpl.computeBoundingBox();
  const srcY = elev - (tpl.boundingBox?.min.y ?? 0);
  viewer.removeSelected();
  for (let i = 0; i < layout.countX; i++)
    for (let j = 0; j < layout.countZ; j++) {
      const obj = viewer._addModelRaw(tpl.clone(), mat.clone(), elev);
      obj.materialPreset = preset;
      obj.mesh.position.set(
        ox + layout.startX + i * layout.itemW - size.x / 2,
        srcY,
        oz + layout.startZ + j * layout.itemD - size.z / 2,
      );
      obj.mesh.updateMatrixWorld();
    }
  viewer.clearSelection();
  viewer.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  return true;
}

export function distributeAcrossPlates(
  viewer: Viewer,
  plates: PlateState[],
  padding = 0.5,
  elevation = 10,
): boolean {
  if (!plates?.length || !viewer.printer) return false;
  const p = viewer.printer as { buildWidthMM: number; buildDepthMM: number };
  const uw = p.buildWidthMM,
    ud = p.buildDepthMM;
  if (uw <= 0 || ud <= 0) return false;
  viewer._saveMultiPlateUndoState();

  const allObjs: { obj: SceneObject; sourcePlate: PlateState }[] = [];
  plates.forEach((pl) => pl.objects.forEach((obj) => allObjs.push({ obj, sourcePlate: pl })));
  if (allObjs.length === 0) return true;

  const bodies = computeBodyFootprints(allObjs.map((a) => a.obj));
  const plateLayouts = plates.map((pl) => ({
    plateId: pl.id,
    originX: pl.originX || 0,
    originZ: pl.originZ || 0,
  }));
  const placements = distributeLayout(bodies, plateLayouts, uw, ud, { padding });
  const placementMap = new Map(placements.map((dp) => [dp.id, dp]));
  const plateMap = new Map(plates.map((pl) => [pl.id, pl]));

  for (const { obj, sourcePlate } of allObjs) {
    const dp = placementMap.get(obj.id);
    if (!dp) continue;
    const targetPlate = plateMap.get(dp.plateId);
    if (!targetPlate) continue;
    const tox = targetPlate.originX || 0,
      toz = targetPlate.originZ || 0;
    applyBodyPlacement(obj, dp, tox, toz, elevation);
    if (sourcePlate.id !== dp.plateId) {
      const idx = sourcePlate.objects.indexOf(obj);
      if (idx !== -1) sourcePlate.objects.splice(idx, 1);
      targetPlate.objects.push(obj);
    }
  }
  viewer.objects = viewer.activePlate.objects;
  viewer.clearSelection();
  viewer.canvas.dispatchEvent(new CustomEvent('selection-changed'));
  viewer.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  return placements.length === allObjs.length;
}

function computeBodyFootprints(objects: SceneObject[]): BodyFootprint[] {
  return objects.map((obj) => {
    const points: Point2D[] = [];
    const addMeshFootprint = (mesh: THREE.Mesh, baseOnly: boolean): void => {
      const posAttr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      mesh.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      if (baseOnly) {
        mesh.geometry.computeBoundingBox();
        const bbox = mesh.geometry.boundingBox;
        if (!bbox) return;
        const localFloor = bbox.min.y;
        const threshold = localFloor + 1;
        for (let i = 0; i < posAttr.count; i++) {
          const ly = posAttr.getY(i);
          if (ly <= threshold) {
            v.fromBufferAttribute(posAttr, i);
            v.applyMatrix4(mesh.matrixWorld);
            points.push({ x: v.x, z: v.z });
          }
        }
      } else {
        for (let i = 0; i < posAttr.count; i++) {
          v.fromBufferAttribute(posAttr, i);
          v.applyMatrix4(mesh.matrixWorld);
          points.push({ x: v.x, z: v.z });
        }
      }
    };
    addMeshFootprint(obj.mesh, false);
    if (obj.supportsMesh) addMeshFootprint(obj.supportsMesh, true);
    let cx = 0,
      cz = 0;
    for (const pt of points) {
      cx += pt.x;
      cz += pt.z;
    }
    cx /= points.length;
    cz /= points.length;
    const centred = points.map((pt) => ({ x: pt.x - cx, z: pt.z - cz }));
    const hull = computeConvexHull(centred);
    const canRotate = !obj.supportsMesh;
    return { id: obj.id, hull, canRotate };
  });
}

function applyArrangePlacements(
  placements: ArrangePlacement[],
  objects: SceneObject[],
  plateOriginX: number,
  plateOriginZ: number,
  elevation: number,
): void {
  const lookup = new Map(objects.map((o) => [o.id, o]));
  for (const pl of placements) {
    const obj = lookup.get(pl.id);
    if (!obj) continue;
    applyBodyPlacement(obj, pl, plateOriginX, plateOriginZ, elevation);
  }
}

function applyBodyPlacement(
  obj: SceneObject,
  placement: ArrangePlacement,
  plateOriginX: number,
  plateOriginZ: number,
  elevation: number,
): void {
  obj.mesh.geometry.computeBoundingBox();
  obj.mesh.updateMatrixWorld(true);
  const box = obj.mesh.geometry.boundingBox
    ? obj.mesh.geometry.boundingBox.clone().applyMatrix4(obj.mesh.matrixWorld)
    : new THREE.Box3();
  if (obj.supportsMesh?.geometry) {
    obj.supportsMesh.geometry.computeBoundingBox();
    obj.supportsMesh.updateMatrixWorld(true);
    const supBB = obj.supportsMesh.geometry.boundingBox;
    if (supBB) box.union(supBB.clone().applyMatrix4(obj.supportsMesh.matrixWorld));
  }
  const center = new THREE.Vector3();
  box.getCenter(center);

  if (Math.abs(placement.angle) > 0.001 && !obj.supportsMesh) {
    obj.mesh.rotateY(placement.angle);
    obj.mesh.updateMatrixWorld(true);
    obj.mesh.geometry.computeBoundingBox();
    const rotBB = obj.mesh.geometry.boundingBox;
    const newBox = rotBB ? rotBB.clone().applyMatrix4(obj.mesh.matrixWorld) : new THREE.Box3();
    newBox.getCenter(center);
    box.copy(newBox);
  }

  const targetX = plateOriginX + placement.x;
  const targetZ = plateOriginZ + placement.z;
  const dx = targetX - center.x;
  const dy = obj.supportsMesh ? 0 - box.min.y : elevation - box.min.y;
  const dz = targetZ - center.z;

  obj.mesh.position.x += dx;
  obj.mesh.position.y += dy;
  obj.mesh.position.z += dz;
  if (!obj.supportsMesh) obj.elevation = elevation;
  obj.mesh.updateMatrixWorld(true);

  if (obj.supportsMesh) {
    obj.supportsMesh.position.x += dx;
    obj.supportsMesh.position.y += dy;
    obj.supportsMesh.position.z += dz;
    obj.supportsMesh.updateMatrixWorld(true);
  }
}
