import * as THREE from 'three';
import { createResinMaterial, type SceneObject } from './viewer-core';
import type { Viewer } from './viewer';
import type { SerializedObject, SerializedPillarSet } from './project-store';
import {
  getPillarSet,
  setPillarSet,
  type ModelPillarSet,
} from './features/support-generation/pillar-store';
import { ensureGeometryBoundsTree } from './geometry-bvh';

function serializeMeshGeo(mesh: THREE.Mesh): {
  positions: ArrayBuffer;
  normals: ArrayBuffer | null;
  position: [number, number, number];
  rotation: [number, number, number, string];
  scale: [number, number, number];
} {
  // Convert indexed geometry to non-indexed so that the index buffer
  // doesn't need to be serialized separately.  Support geometry from
  // buildSupportGeometry is indexed; dropping the index on save produced
  // garbled triangles on reload.
  const srcGeo = mesh.geometry;
  const geo = srcGeo.index ? srcGeo.toNonIndexed() : srcGeo;
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const normAttr = geo.getAttribute('normal') as THREE.BufferAttribute | null;
  const posArr = posAttr.array as Float32Array;
  const normArr = normAttr ? (normAttr.array as Float32Array) : null;
  const result = {
    positions: new Float32Array(posArr).buffer as ArrayBuffer,
    normals: normArr ? (new Float32Array(normArr).buffer as ArrayBuffer) : null,
    position: [mesh.position.x, mesh.position.y, mesh.position.z] as [number, number, number],
    rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z, mesh.rotation.order] as [
      number,
      number,
      number,
      string,
    ],
    scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z] as [number, number, number],
  };
  if (geo !== srcGeo) geo.dispose();
  return result;
}

function restoreMesh(
  data: {
    positions: ArrayBuffer;
    normals: ArrayBuffer | null;
    position: [number, number, number];
    rotation: [number, number, number, string];
    scale: [number, number, number];
  },
  material: THREE.Material,
): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(new Float32Array(data.positions), 3),
  );
  if (data.normals) {
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(data.normals), 3));
  } else {
    geo.computeVertexNormals();
  }
  geo.computeBoundingBox();
  ensureGeometryBoundsTree(geo);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(data.position[0], data.position[1], data.position[2]);
  mesh.rotation.set(
    data.rotation[0],
    data.rotation[1],
    data.rotation[2],
    data.rotation[3] as THREE.EulerOrder,
  );
  mesh.scale.set(data.scale[0], data.scale[1], data.scale[2]);
  mesh.updateMatrixWorld(true);
  return mesh;
}

function serializePillarSet(set: ModelPillarSet): SerializedPillarSet | null {
  const supportStructures = set.supportStructures ?? [];
  if (set.legacyOpaque || (set.pillars.length === 0 && supportStructures.length === 0)) {
    return null;
  }
  return {
    pillars: set.pillars.map((p) => ({
      id: p.id,
      origin: p.origin,
      route: p.route.map((w) => {
        const wp: { x: number; y: number; z: number; internalResting?: boolean } = {
          x: w.x,
          y: w.y,
          z: w.z,
        };
        if (w.internalResting) wp.internalResting = true;
        return wp;
      }),
      tipDiameter: p.tipDiameter,
      pillarRadius: p.pillarRadius,
      baseRadius: p.baseRadius,
      tipHeight: p.tipHeight,
      baseHeight: p.baseHeight,
      contact: { x: p.contact.x, y: p.contact.y, z: p.contact.z },
      bridgeTarget: p.bridgeTarget
        ? { x: p.bridgeTarget.x, y: p.bridgeTarget.y, z: p.bridgeTarget.z }
        : undefined,
    })),
    supportStructures: supportStructures.map((structure) => ({
      id: structure.id,
      origin: structure.origin,
      kind: structure.kind,
      touchpoints: structure.touchpoints.map((touchpoint) => ({
        id: touchpoint.id,
        nodeId: touchpoint.nodeId,
        position: { ...touchpoint.position },
        normal: { ...touchpoint.normal },
        diameter: touchpoint.diameter,
        shape: touchpoint.shape,
        priority: touchpoint.priority,
        enabled: touchpoint.enabled,
      })),
      nodes: structure.nodes.map((node) => ({
        id: node.id,
        position: { ...node.position },
        radius: node.radius,
        kind: node.kind,
      })),
      edges: structure.edges.map((edge) => ({ ...edge })),
    })),
    settings: {
      crossBracing: set.settings.crossBracing,
      baseBracing: set.settings.baseBracing ? { ...set.settings.baseBracing } : null,
      basePan: set.settings.basePan ? { ...set.settings.basePan } : null,
      sphericalConnection: set.settings.sphericalConnection
        ? { ...set.settings.sphericalConnection }
        : null,
      supportFloorY: set.settings.supportFloorY,
      bracingCollisionRadius: set.settings.bracingCollisionRadius,
    },
  };
}

export function serializeObjects(viewer: Viewer, objects?: SceneObject[]): SerializedObject[] {
  const objs = objects ?? viewer.objects;
  return objs.map((obj) => {
    const meshData = serializeMeshGeo(obj.mesh);
    const set = getPillarSet(obj.id);
    return {
      id: obj.id,
      ...meshData,
      elevation: obj.elevation,
      materialPreset: obj.materialPreset,
      paintStrokes: obj.paintStrokes?.map((stroke) => ({
        ...stroke,
        localPoint: [...stroke.localPoint],
      })),
      intentBuffer: obj.intentBuffer ? Array.from(obj.intentBuffer) : undefined,
      supports: obj.supportsMesh && set.legacyOpaque ? serializeMeshGeo(obj.supportsMesh) : null,
      pillarSet: serializePillarSet(set),
    };
  });
}

export function rebuildPillarSetsAfterRestore(viewer: Viewer, ids: string[]): void {
  for (const id of ids) {
    const set = getPillarSet(id);
    if (!set.legacyOpaque && (set.pillars.length > 0 || (set.supportStructures?.length ?? 0) > 0)) {
      viewer.rebuildSupportsFromStore(id);
    }
  }
}

export function restoreSerializedObjects(viewer: Viewer, data: SerializedObject[]): SceneObject[] {
  const objects = data.map((item) => {
    const material = createResinMaterial(item.materialPreset);
    const mesh = restoreMesh(item, material);
    const id = item.id;
    mesh.userData.id = id;
    viewer.scene.add(mesh);

    let supportsMesh: THREE.Mesh | null = null;

    if (
      item.pillarSet &&
      (item.pillarSet.pillars.length > 0 || (item.pillarSet.supportStructures?.length ?? 0) > 0)
    ) {
      // Rework-era project: restore per-pillar data. Mesh is rebuilt below
      // after the object is added to the plate (rebuildSupportsFromStore
      // needs findObjectAnywhere to succeed).
      const s = item.pillarSet;
      const restoredSet: ModelPillarSet = {
        pillars: s.pillars.map((p) => ({
          id: p.id,
          origin: p.origin,
          route: p.route.map((w) => {
            const wp: { x: number; y: number; z: number; internalResting?: boolean } = {
              x: w.x,
              y: w.y,
              z: w.z,
            };
            if (w.internalResting) wp.internalResting = true;
            return wp;
          }),
          tipDiameter: p.tipDiameter,
          pillarRadius: p.pillarRadius,
          baseRadius: p.baseRadius,
          tipHeight: p.tipHeight,
          baseHeight: p.baseHeight,
          contact: { x: p.contact.x, y: p.contact.y, z: p.contact.z },
          bridgeTarget: p.bridgeTarget
            ? { x: p.bridgeTarget.x, y: p.bridgeTarget.y, z: p.bridgeTarget.z }
            : undefined,
        })),
        supportStructures: s.supportStructures?.map((structure) => ({
          id: structure.id,
          origin: structure.origin,
          kind: structure.kind,
          touchpoints: structure.touchpoints.map((touchpoint) => ({
            id: touchpoint.id,
            nodeId: touchpoint.nodeId,
            position: { ...touchpoint.position },
            normal: { ...touchpoint.normal },
            diameter: touchpoint.diameter,
            shape: touchpoint.shape,
            priority: touchpoint.priority,
            enabled: touchpoint.enabled,
          })),
          nodes: structure.nodes.map((node) => ({
            id: node.id,
            position: { ...node.position },
            radius: node.radius,
            kind: node.kind,
          })),
          edges: structure.edges.map((edge) => ({ ...edge })),
        })),
        settings: {
          crossBracing: s.settings.crossBracing,
          baseBracing: s.settings.baseBracing ? { ...s.settings.baseBracing } : null,
          basePan: s.settings.basePan ? { ...s.settings.basePan } : null,
          sphericalConnection: s.settings.sphericalConnection
            ? { ...s.settings.sphericalConnection }
            : null,
          supportFloorY: s.settings.supportFloorY,
          bracingCollisionRadius: s.settings.bracingCollisionRadius,
        },
      };
      setPillarSet(id, restoredSet);
    } else if (item.supports) {
      // Pre-rework project: restore opaque support mesh, mark as legacy.
      const supMat = new THREE.MeshPhongMaterial({
        color: 0x9b59b6,
        specular: 0x222222,
        shininess: 30,
        transparent: true,
        opacity: 0.55,
      });
      supportsMesh = restoreMesh(item.supports, supMat);
      viewer.scene.add(supportsMesh);
      setPillarSet(id, {
        pillars: [],
        settings: {
          crossBracing: false,
          baseBracing: null,
          basePan: null,
          sphericalConnection: null,
          supportFloorY: 0,
          bracingCollisionRadius: 0.2,
        },
        legacyOpaque: true,
      });
    }

    return {
      id,
      mesh,
      supportsMesh,
      bracingMesh: null,
      elevation: item.elevation,
      materialPreset: item.materialPreset,
      paintStrokes: item.paintStrokes?.map((stroke) => ({
        ...stroke,
        localPoint: [...stroke.localPoint],
        density: stroke.density ?? 0.8,
        depthMM: stroke.depthMM ?? 0.5,
        bumpStrength: stroke.bumpStrength ?? 0.6,
        pattern: stroke.pattern ?? 0,
        patternScaleMM: stroke.patternScaleMM ?? 2,
      })),
      intentBuffer: item.intentBuffer ? new Uint8Array(item.intentBuffer) : undefined,
    } as SceneObject;
  });
  // Rebuild pillar meshes after objects are returned and added to the plate.
  // Uses queueMicrotask so the caller's plate assignment completes first.
  const idsToRebuild = objects
    .filter((o) => {
      const set = getPillarSet(o.id);
      return (
        !set.legacyOpaque && (set.pillars.length > 0 || (set.supportStructures?.length ?? 0) > 0)
      );
    })
    .map((o) => o.id);
  if (idsToRebuild.length > 0) {
    queueMicrotask(() => {
      for (const id of idsToRebuild) viewer.rebuildSupportsFromStore(id);
    });
  }
  return objects;
}
