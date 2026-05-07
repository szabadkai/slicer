/**
 * Measurement tool — two-click distance measurement on model surfaces.
 *
 * Click two points on any model to see the Euclidean distance
 * and per-axis deltas. Renders dot markers + line in the 3D scene.
 */
import * as THREE from 'three';
import type { AppContext } from '@core/types';
import { listen } from '@features/app-shell/utils';

interface MeasurePoint {
  position: THREE.Vector3;
  marker: THREE.Mesh;
}

const MARKER_COLOR = 0x00e5ff;
const LINE_COLOR = 0x00e5ff;
const MARKER_RADIUS = 0.3;

export function mountMeasureTool(ctx: AppContext): void {
  const { viewer } = ctx;
  const canvas = viewer.canvas as HTMLCanvasElement;
  const clearBtn = document.getElementById('measure-clear-btn');
  const resultEl = document.getElementById('measure-result');
  const distanceEl = document.getElementById('measure-distance');
  const dxEl = document.getElementById('measure-dx');
  const dyEl = document.getElementById('measure-dy');
  const dzEl = document.getElementById('measure-dz');

  let pointA: MeasurePoint | null = null;
  let pointB: MeasurePoint | null = null;
  let line: THREE.Line | null = null;
  let active = false;

  const scene = viewer.scene as THREE.Scene;
  const camera = viewer.camera as THREE.PerspectiveCamera;

  function createMarker(pos: THREE.Vector3): THREE.Mesh {
    const geo = new THREE.SphereGeometry(MARKER_RADIUS, 12, 12);
    const mat = new THREE.MeshBasicMaterial({
      color: MARKER_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.renderOrder = 999;
    scene.add(mesh);
    return mesh;
  }

  function createLine(a: THREE.Vector3, b: THREE.Vector3): THREE.Line {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineBasicMaterial({
      color: LINE_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.8,
    });
    const l = new THREE.Line(geo, mat);
    l.renderOrder = 998;
    scene.add(l);
    return l;
  }

  function clearMeasurement(): void {
    if (pointA) {
      scene.remove(pointA.marker);
      pointA.marker.geometry.dispose();
      (pointA.marker.material as THREE.Material).dispose();
      pointA = null;
    }
    if (pointB) {
      scene.remove(pointB.marker);
      pointB.marker.geometry.dispose();
      (pointB.marker.material as THREE.Material).dispose();
      pointB = null;
    }
    if (line) {
      scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      line = null;
    }
    if (resultEl) resultEl.hidden = true;
    viewer.requestRender();
  }

  function displayResult(a: THREE.Vector3, b: THREE.Vector3): void {
    const dist = a.distanceTo(b);
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    const dz = Math.abs(b.z - a.z);

    if (distanceEl) distanceEl.textContent = `${dist.toFixed(3)} mm`;
    if (dxEl) dxEl.textContent = `${dx.toFixed(3)} mm`;
    if (dyEl) dyEl.textContent = `${dy.toFixed(3)} mm`;
    if (dzEl) dzEl.textContent = `${dz.toFixed(3)} mm`;
    if (resultEl) resultEl.hidden = false;
  }

  function handleClick(e: MouseEvent): void {
    if (!active) return;

    const objects = viewer.objects;
    if (!objects || objects.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);

    const meshes = objects.map((o: { mesh: unknown }) => o.mesh as THREE.Object3D);
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return;

    const hitPoint = hits[0].point.clone();

    if (!pointA) {
      pointA = { position: hitPoint, marker: createMarker(hitPoint) };
    } else if (!pointB) {
      pointB = { position: hitPoint, marker: createMarker(hitPoint) };
      line = createLine(pointA.position, pointB.position);
      displayResult(pointA.position, pointB.position);
    } else {
      // Reset and start new measurement
      clearMeasurement();
      pointA = { position: hitPoint, marker: createMarker(hitPoint) };
    }

    viewer.requestRender();
  }

  canvas.addEventListener('click', handleClick);

  listen(clearBtn, 'click', () => clearMeasurement());

  // Activate/deactivate with the measure panel
  const observer = new MutationObserver(() => {
    const panel = document.getElementById('measure-panel');
    if (panel) {
      active = !panel.hidden;
      if (!active) clearMeasurement();
    }
  });
  const panel = document.getElementById('measure-panel');
  if (panel) observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });

  // Active state is managed by panel visibility via MutationObserver
}
