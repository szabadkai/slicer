import * as THREE from 'three';
import { createResinMaterial, type SceneObject } from './viewer-core';
import type { Viewer } from './viewer';
import type { SerializedObject } from './project-store';

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
    rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z, mesh.rotation.order] as [number, number, number, string],
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

export function serializeObjects(viewer: Viewer, objects?: SceneObject[]): SerializedObject[] {
  const objs = objects ?? viewer.objects;
  return objs.map((obj) => {
    const meshData = serializeMeshGeo(obj.mesh);
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
      supports: obj.supportsMesh ? serializeMeshGeo(obj.supportsMesh) : null,
    };
  });
}

export function restoreSerializedObjects(viewer: Viewer, data: SerializedObject[]): SceneObject[] {
  return data.map((item) => {
    const material = createResinMaterial(item.materialPreset);
    const mesh = restoreMesh(item, material);
    const id = item.id;
    mesh.userData.id = id;
    viewer.scene.add(mesh);

    let supportsMesh: THREE.Mesh | null = null;
    if (item.supports) {
      const supMat = new THREE.MeshPhysicalMaterial({
        color: 0x88aacc,
        roughness: 0.6,
        metalness: 0,
        transparent: true,
        opacity: 0.85,
      });
      supportsMesh = restoreMesh(item.supports, supMat);
      viewer.scene.add(supportsMesh);
    }

    return {
      id,
      mesh,
      supportsMesh,
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
}
