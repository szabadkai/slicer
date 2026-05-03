/**
 * Scene building — grid, build-plate visualization, lights.
 *
 * These functions are extracted from the Viewer class to keep
 * the main viewer.ts under 600 LOC.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Grid & build-plate visualization
// ---------------------------------------------------------------------------

interface PlateInfo {
  originX: number;
  originZ: number;
}

interface PrinterInfo {
  buildWidthMM: number;
  buildDepthMM: number;
  buildHeightMM: number;
}

export interface BuildVolumeEdge {
  plate: PlateInfo;
  lines: THREE.LineSegments;
}

export function buildGridGroup(
  printer: PrinterInfo,
  plates: PlateInfo[],
  activePlate: PlateInfo,
): { group: THREE.Group; buildVolumeEdges: BuildVolumeEdge[] } {
  const group = new THREE.Group();
  const buildVolumeEdges: BuildVolumeEdge[] = [];

  const w = printer.buildWidthMM;
  const d = printer.buildDepthMM;
  const h = printer.buildHeightMM;

  for (const plate of plates) {
    const originX = plate.originX || 0;
    const originZ = plate.originZ || 0;
    const isActive = plate === activePlate;

    // Build plate surface
    const plateThickness = 1;
    const plateGeo = new THREE.BoxGeometry(w, plateThickness, d);
    const plateMat = new THREE.MeshPhongMaterial({
      color: isActive ? 0xffffff : 0xf7f8fa,
      specular: 0x111111,
      shininess: 5,
    });
    const plateMesh = new THREE.Mesh(plateGeo, plateMat);
    plateMesh.position.set(originX, -plateThickness / 2, originZ);
    group.add(plateMesh);

    // Grid lines
    const lines: number[] = [];
    const colors: number[] = [];
    const colorMajor = new THREE.Color(isActive ? 0x555555 : 0x8a8f96);
    const colorMinor = new THREE.Color(isActive ? 0xcccccc : 0xd9dde2);
    const halfW = w / 2;
    const halfD = d / 2;

    for (let x = -Math.floor(halfW); x <= Math.floor(halfW); x++) {
      lines.push(originX + x, 0, originZ - halfD, originX + x, 0, originZ + halfD);
      const c = x % 10 === 0 ? colorMajor : colorMinor;
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let z = -Math.floor(halfD); z <= Math.floor(halfD); z++) {
      lines.push(originX - halfW, 0, originZ + z, originX + halfW, 0, originZ + z);
      const c = z % 10 === 0 ? colorMajor : colorMinor;
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }

    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    gridGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    gridGeo.translate(0, 0.01, 0);
    const gridMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: isActive ? 0.7 : 0.45 });
    group.add(new THREE.LineSegments(gridGeo, gridMat));

    // Build volume box
    const volGeo = new THREE.BoxGeometry(w, h, d);
    volGeo.translate(0, h / 2, 0);
    const volMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: isActive ? 0.1 : 0.04, depthWrite: false });
    const volMesh = new THREE.Mesh(volGeo, volMat);
    volMesh.position.set(originX, 0, originZ);
    group.add(volMesh);

    // Build volume edges
    const edges = new THREE.EdgesGeometry(volGeo);
    const volLines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
      color: isActive ? 0x0070f3 : 0x888888,
      transparent: true,
      opacity: isActive ? 0.7 : 0.3,
    }));
    volLines.position.set(originX, 0, originZ);
    group.add(volLines);
    buildVolumeEdges.push({ plate, lines: volLines });

    // Plate number label
    const numberMesh = createPlateNumberMesh(plates.indexOf(plate) + 1, isActive, Math.min(w, d) * 0.25);
    numberMesh.position.set(originX, 0.06, originZ);
    group.add(numberMesh);
  }

  return { group, buildVolumeEdges };
}

function createPlateNumberMesh(number: number, isActive: boolean, size: number): THREE.Mesh {
  const canvas = document.createElement('canvas');
  const texSize = 256;
  canvas.width = texSize;
  canvas.height = texSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D canvas context');
  ctx.clearRect(0, 0, texSize, texSize);
  ctx.fillStyle = isActive ? '#0070f3' : '#888888';
  ctx.font = 'bold 180px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), texSize / 2, texSize / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const geo = new THREE.PlaneGeometry(size, size);
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 10;
  return mesh;
}

// ---------------------------------------------------------------------------
// Lights
// ---------------------------------------------------------------------------

export function setupLights(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(50, 100, 50);
  scene.add(dir);
  const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
  dir2.position.set(-50, 50, -50);
  scene.add(dir2);
}

// ---------------------------------------------------------------------------
// Face markers
// ---------------------------------------------------------------------------

export function addSignificantFaceMarker(
  scene: THREE.Scene,
  markers: THREE.Group[],
  centroid: THREE.Vector3,
  normal: THREE.Vector3,
  area: number,
  color: number,
  index: number,
  options: { size?: number; surfaceOffset?: number; arrowLength?: number; showLabel?: boolean } = {},
): void {
  const arrowDir = normal.clone().normalize();
  const markerSize = options.size ?? THREE.MathUtils.clamp(Math.sqrt(Math.max(area, 1)) * 0.22, 2.5, 9);
  const surfaceOffset = options.surfaceOffset ?? THREE.MathUtils.clamp(markerSize * 0.16, 0.35, 1.2);
  const arrowLength = options.arrowLength ?? markerSize * 2.2;
  const markerOrigin = centroid.clone().addScaledVector(arrowDir, surfaceOffset);

  const markerGroup = new THREE.Group();
  markerGroup.position.copy(markerOrigin);

  // Ring
  const ringGeo = new THREE.RingGeometry(markerSize * 0.42, markerSize * 0.62, 36);
  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), arrowDir);
  ring.renderOrder = 1000;
  markerGroup.add(ring);

  // Dot
  const dotGeo = new THREE.SphereGeometry(markerSize * 0.14, 16, 8);
  const dotMat = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false });
  const dot = new THREE.Mesh(dotGeo, dotMat);
  dot.renderOrder = 1001;
  markerGroup.add(dot);

  // Arrow
  const arrow = new THREE.ArrowHelper(arrowDir, arrowDir.clone().multiplyScalar(markerSize * 0.45), arrowLength, color, markerSize * 0.55, markerSize * 0.34);
  (arrow.cone.material as THREE.MeshBasicMaterial).depthTest = false;
  (arrow.cone.material as THREE.MeshBasicMaterial).depthWrite = false;
  (arrow.line.material as THREE.LineBasicMaterial).depthTest = false;
  (arrow.line.material as THREE.LineBasicMaterial).depthWrite = false;
  arrow.cone.renderOrder = 1002;
  arrow.line.renderOrder = 1002;
  markerGroup.add(arrow);

  // Label
  if (options.showLabel !== false) {
    const labelCanvas = document.createElement('canvas');
    const ctx = labelCanvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D canvas context');
    labelCanvas.width = 64;
    labelCanvas.height = 64;
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(index.toString(), 32, 32);
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    const labelMat = new THREE.SpriteMaterial({ map: labelTexture, depthTest: false, depthWrite: false });
    const label = new THREE.Sprite(labelMat);
    label.scale.set(markerSize * 0.55, markerSize * 0.55, 1);
    label.position.copy(arrowDir.clone().multiplyScalar(arrowLength + markerSize * 0.65));
    label.renderOrder = 1003;
    markerGroup.add(label);
  }

  markerGroup.userData = { centroid: centroid.clone(), normal: arrowDir.clone(), area };
  scene.add(markerGroup);
  markers.push(markerGroup);
}

export function clearSignificantFaceMarkers(scene: THREE.Scene, markers: THREE.Group[]): void {
  for (const marker of markers) {
    scene.remove(marker);
    marker.traverse((child) => {
      const obj = child as THREE.Mesh;
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mat = obj.material as THREE.MeshBasicMaterial;
        if (mat.map) mat.map.dispose();
        mat.dispose();
      }
    });
  }
  markers.length = 0;
}
