import * as THREE from 'three';

/**
 * Auto-orientation engine.
 *
 * Evaluates candidate orientations and scores them based on preset strategy.
 * Inspired by STL-Tweaker (Salzburg Research) and PrusaSlicer.
 *
 * Candidate orientations: 26 directions
 *   6 face-aligned (cube faces)
 *   12 edge-aligned (cube edges)
 *   8 corner-aligned (cube corners)
 */

const UP = new THREE.Vector3(0, 1, 0);

// Generate 26 candidate "up" directions
function generateCandidates() {
  const dirs = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue;
        dirs.push(new THREE.Vector3(x, y, z).normalize());
      }
    }
  }
  return dirs;
}

const CANDIDATES = generateCandidates();

/**
 * Analyze geometry for a given "up" direction.
 * Returns metrics used for scoring.
 */
function analyzeOrientation(geometry, upDir) {
  const pos = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const triCount = pos.count / 3;

  let overhangArea = 0;
  let totalHeight = 0;
  let staircaseMetric = 0;
  let flatBottomArea = 0;

  // We need to figure out the model height in this orientation
  // Project all vertices onto upDir
  let minProj = Infinity, maxProj = -Infinity;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const proj = v.dot(upDir);
    if (proj < minProj) minProj = proj;
    if (proj > maxProj) maxProj = proj;
  }
  totalHeight = maxProj - minProj;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const cross = new THREE.Vector3();

  const overhangThreshold = Math.cos(THREE.MathUtils.degToRad(30)); // 30 deg from horizontal

  for (let i = 0; i < triCount; i++) {
    const idx = i * 3;
    a.set(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
    b.set(pos.getX(idx + 1), pos.getY(idx + 1), pos.getZ(idx + 1));
    c.set(pos.getX(idx + 2), pos.getY(idx + 2), pos.getZ(idx + 2));

    if (normal) {
      n.set(normal.getX(idx), normal.getY(idx), normal.getZ(idx));
    } else {
      edge1.subVectors(b, a);
      edge2.subVectors(c, a);
      n.crossVectors(edge1, edge2).normalize();
    }

    // Triangle area
    edge1.subVectors(b, a);
    edge2.subVectors(c, a);
    cross.crossVectors(edge1, edge2);
    const area = cross.length() * 0.5;

    // Dot product of face normal with up direction
    const dot = n.dot(upDir);

    // Overhang: face pointing downward (away from up) and not vertical
    // dot < 0 means face normal opposes up direction (downward-facing)
    if (dot < -overhangThreshold) {
      overhangArea += area;
    }

    // Flat bottom: faces pointing straight down (good for build plate contact)
    if (dot < -0.99) {
      flatBottomArea += area;
    }

    // Staircase: faces nearly parallel to up direction (vertical walls)
    // These look fine. Faces nearly perpendicular to up but not quite
    // show stairstepping artifacts.
    const absDot = Math.abs(dot);
    if (absDot > 0.1 && absDot < 0.5) {
      staircaseMetric += area * (0.5 - absDot);
    }
  }

  return { overhangArea, totalHeight, staircaseMetric, flatBottomArea };
}

/**
 * Score an orientation based on preset strategy.
 */
function scoreOrientation(metrics, preset) {
  const { overhangArea, totalHeight, staircaseMetric, flatBottomArea } = metrics;

  switch (preset) {
    case 'fastest':
      // Minimize height (fewer layers = faster print)
      return -totalHeight;

    case 'least-support':
      // Minimize overhang area, reward flat bottom contact
      return -overhangArea + flatBottomArea * 0.5;

    case 'best-quality':
      // Minimize overhangs + stairstepping, reward flat bottom
      return -overhangArea - staircaseMetric * 2 + flatBottomArea * 0.3;

    default:
      return -overhangArea;
  }
}

/**
 * Find optimal orientation using the Genetic Algorithm running in a WebWorker.
 * Returns a Promise that resolves to a quaternion.
 */
export function optimizeOrientationAsync(geometry, preset, onProgress) {
  return new Promise((resolve, reject) => {
    // We create the worker from the compiled JS
    const worker = new Worker(new URL('./orientation.worker.js', import.meta.url), {
      type: 'module'
    });

    worker.onmessage = (e) => {
      const { type, progress, message, quaternion } = e.data;
      if (type === 'progress') {
        if (onProgress) onProgress(progress, message);
      } else if (type === 'complete') {
        worker.terminate();
        resolve(new THREE.Quaternion().fromArray(quaternion));
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };

    // Extract geometry data avoiding complex ThreeJS objects
    const positionArray = geometry.attributes.position.array;
    const normalArray = geometry.attributes.normal ? geometry.attributes.normal.array : null;
    const triCount = geometry.attributes.position.count / 3;

    worker.postMessage({
      type: 'optimize',
      positionArray,
      normalArray,
      triCount,
      preset
    });
  });
}

/**
 * Find optimal orientation using the legacy brute force method.
 * Returns a quaternion that rotates the current up direction to the best orientation.
 */
export function findOptimalOrientation(geometry, preset) {
  let bestScore = -Infinity;
  let bestDir = UP.clone();

  for (const candidate of CANDIDATES) {
    const metrics = analyzeOrientation(geometry, candidate);
    const score = scoreOrientation(metrics, preset);
    if (score > bestScore) {
      bestScore = score;
      bestDir = candidate.clone();
    }
  }

  // Compute quaternion to rotate bestDir to align with Y-up
  const quaternion = new THREE.Quaternion();
  quaternion.setFromUnitVectors(bestDir, UP);
  return quaternion;
}

/**
 * Get analysis metrics for the current orientation (up = Y).
 */
export function analyzeCurrentOrientation(geometry) {
  return analyzeOrientation(geometry, UP);
}

/**
 * Find significant (large flat) faces on the model.
 * Returns array of { normal, area, centroid } for each significant face.
 * @param {THREE.BufferGeometry} geometry - The model geometry
 * @param {number} minArea - Minimum area threshold (default 10 mm²)
 * @param {number} flatnessThreshold - How parallel normals need to be (default 0.95)
 * @returns {Array<{ normal: THREE.Vector3, area: number, centroid: THREE.Vector3 }>}
 */
export function findSignificantFaces(geometry, minArea = 10, flatnessThreshold = 0.95) {
  const pos = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const triCount = pos.count / 3;
  
  // Group triangles by their normal direction
  const faceGroups = new Map();
  
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();
  const cross = new THREE.Vector3();
  
  for (let i = 0; i < triCount; i++) {
    const idx = i * 3;
    a.set(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
    b.set(pos.getX(idx + 1), pos.getY(idx + 1), pos.getZ(idx + 1));
    c.set(pos.getX(idx + 2), pos.getY(idx + 2), pos.getZ(idx + 2));
    
    // Calculate face normal
    if (normal) {
      faceNormal.set(normal.getX(idx), normal.getY(idx), normal.getZ(idx)).normalize();
    } else {
      edge1.subVectors(b, a);
      edge2.subVectors(c, a);
      cross.crossVectors(edge1, edge2);
      if (cross.length() < 1e-10) continue;
      faceNormal.copy(cross).normalize();
    }
    
    // Calculate triangle area
    edge1.subVectors(b, a);
    edge2.subVectors(c, a);
    cross.crossVectors(edge1, edge2);
    const area = cross.length() * 0.5;
    
    if (area < 0.001) continue; // Skip degenerate triangles
    
    // Calculate centroid
    const centroid = new THREE.Vector3(
      (a.x + b.x + c.x) / 3,
      (a.y + b.y + c.y) / 3,
      (a.z + b.z + c.z) / 3
    );
    
    // Create a key for this normal direction (quantize to reduce noise sensitivity)
    const nx = Math.round(faceNormal.x * 10) / 10;
    const ny = Math.round(faceNormal.y * 10) / 10;
    const nz = Math.round(faceNormal.z * 10) / 10;
    const key = `${nx},${ny},${nz}`;
    
    if (!faceGroups.has(key)) {
      faceGroups.set(key, { normal: faceNormal.clone().normalize(), triangles: [] });
    }
    faceGroups.get(key).triangles.push({ area, centroid });
  }
  
  // Aggregate triangles into faces and filter by minimum area
  const significantFaces = [];
  
  for (const [key, group] of faceGroups) {
    const totalArea = group.triangles.reduce((sum, t) => sum + t.area, 0);
    if (totalArea < minArea) continue;
    
    // Calculate weighted centroid
    let weightedCentroid = new THREE.Vector3();
    for (const t of group.triangles) {
      weightedCentroid.addScaledVector(t.centroid, t.area);
    }
    weightedCentroid.divideScalar(totalArea);
    
    // Check if the face is actually flat (triangles don't diverge too much)
    let maxDeviation = 0;
    const refNormal = group.normal;
    for (const t of group.triangles) {
      const toCentroid = new THREE.Vector3().subVectors(weightedCentroid, t.centroid);
      const dist = toCentroid.length();
      // Rough flatness check - max deviation from plane
      maxDeviation = Math.max(maxDeviation, dist * 0.1);
    }
    
    // Only include if the group is reasonably flat
    if (maxDeviation < 2) { // mm tolerance
      significantFaces.push({
        normal: group.normal.clone(),
        area: totalArea,
        centroid: weightedCentroid,
        triangleCount: group.triangles.length
      });
    }
  }
  
  // Sort by area (largest first)
  significantFaces.sort((a, b) => b.area - a.area);
  
  // Return top significant faces (limit to avoid cluttering)
  return significantFaces.slice(0, 6);
}
