import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/**
 * Advanced support generation for SLA printing.
 *
 * Support anatomy (bottom to top):
 *   Base (wide cone on build plate)
 *   Vertical shaft (straight pillar)
 *   Angled section (optional, routes around model to reach occluded overhangs)
 *   Tip (tapered cone touching the model)
 *
 * Pipeline:
 * 1. Detect overhang faces
 * 2. Sample contact points on overhang surfaces
 * 3. For each contact point, raycast downward to check for model collision
 *    - If clear path: straight vertical support
 *    - If blocked: route support at an angle to clear the obstruction
 * 4. Build support geometry with proper tip/shaft/base
 * 5. Return merged geometry
 */

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const SUPPORT_SEGMENTS = 6; // polygon sides for cylinders/cones

/**
 * Generate support structures for the given geometry.
 */
export async function generateSupports(geometry, options = {}) {
  const {
    overhangAngle = 30,
    density = 5,
    autoDensity = false,
    tipDiameter = 0.4,
    supportThickness = 0.8,
    autoThickness = true,
    internalSupports = false,
    crossBracing = false,
    onProgress,
  } = options;

  // Compute effective density
  let effectiveDensity = density;
  if (autoDensity) {
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const maxDim = Math.max(
      bb.max.x - bb.min.x,
      bb.max.y - bb.min.y,
      bb.max.z - bb.min.z
    );
    // Small models (~10mm) → density 8 (tight spacing)
    // Medium models (~50mm) → density 5
    // Large models (~200mm) → density 3 (wide spacing)
    effectiveDensity = THREE.MathUtils.clamp(
      Math.round(9 - (maxDim - 10) * (5 / 190)),
      2, 9
    );
  }

  if (onProgress) onProgress(0, "Finding contact points...");
  await new Promise(r => setTimeout(r, 0));
  const contactPoints = await findContactPoints(geometry, overhangAngle, effectiveDensity, (text) => {
    if (onProgress) onProgress(0, text);
  });
  if (contactPoints.length === 0) return new THREE.BufferGeometry();

  if (onProgress) {
    onProgress(0.1, "Building bounds tree...");
    await new Promise(r => setTimeout(r, 0));
  }

  // Build a simple mesh for raycasting collision checks
  if (!geometry.boundsTree) {
    geometry.computeBoundsTree();
  }
  const tempMesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial()
  );
  tempMesh.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = false; // We need all hits to filter out the contact point itself

  let actualTipDiameter = tipDiameter;
  let actualSupportThickness = supportThickness;
  if (autoThickness) {
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const maxDim = Math.max(
      bb.max.x - bb.min.x,
      bb.max.y - bb.min.y,
      bb.max.z - bb.min.z
    );
    actualTipDiameter = THREE.MathUtils.clamp(0.2 + (maxDim - 10) * (0.8 / 190), 0.2, 1.5);
    actualSupportThickness = actualTipDiameter * 1.5;
  }

  const pillarRadius = actualSupportThickness / 2;
  const tipHeight = actualTipDiameter * 3;
  const baseRadius = pillarRadius * 2.5;
  const baseHeight = 0.6;
  const minSupportHeight = tipHeight + baseHeight + 0.5;

  const geometries = [];
  const routes = [];

  const totalPoints = contactPoints.length;
  for (let i = 0; i < totalPoints; i++) {
    const point = contactPoints[i];
    const { position } = point;
    if (position.y > minSupportHeight) {
      // Raycast straight down from contact point to find obstructions
      const route = planSupportRoute(
        position, tempMesh, raycaster, pillarRadius, baseHeight, actualTipDiameter, tipHeight, internalSupports
      );

      if (route) routes.push(route);
    }

    if (i % 200 === 0 && onProgress) {
      onProgress(0.1 + 0.6 * (i / totalPoints), `Planning routes... ${Math.round(i / totalPoints * 100)}%`);
      await new Promise(r => setTimeout(r, 0));
    }
  }

  if (onProgress) onProgress(0.7, "Building geometry...");
  const totalRoutes = routes.length;
  for (let i = 0; i < totalRoutes; i++) {
    const route = routes[i];
    buildSupportGeometry(
      route, geometries, actualTipDiameter, tipHeight, pillarRadius, baseRadius, baseHeight
    );

    if (i % 500 === 0 && onProgress) {
      onProgress(0.7 + 0.2 * (i / totalRoutes), `Building geometry... ${Math.round(i / totalRoutes * 100)}%`);
      await new Promise(r => setTimeout(r, 0));
    }
  }

  if (crossBracing) {
    if (onProgress) {
      onProgress(0.9, "Generating cross bracing...");
      await new Promise(r => setTimeout(r, 0));
    }
    generateCrossBracing(routes, geometries, pillarRadius, baseHeight, tipHeight);
  }

  if (onProgress) {
    onProgress(0.95, "Merging geometry...");
    await new Promise(r => setTimeout(r, 0));
  }
  if (geometries.length === 0) return new THREE.BufferGeometry();
  return mergeGeometries(geometries);
}

/**
 * Plan the route from a contact point to the build plate.
 *
 * Returns an array of waypoints [{x, y, z}] from top (contact) to bottom (base).
 * The route may include an angled section to avoid model collision.
 */
function planSupportRoute(contactPos, mesh, raycaster, pillarRadius, baseHeight, tipDiameter, tipHeight, internalSupports) {
  const clearance = pillarRadius * 3; // min distance from model surface

  // Cast ray straight down from contact point
  raycaster.set(
    new THREE.Vector3(contactPos.x, contactPos.y - 0.01, contactPos.z),
    DOWN
  );
  raycaster.far = contactPos.y;
  const hits = raycaster.intersectObject(mesh);

  // Filter hits that are below the contact point (not self-intersection)
  const validHits = hits.filter(h => h.point.y < contactPos.y - 0.5);

  if (validHits.length === 0) {
    // Clear path straight down — simple vertical support
    return [
      { x: contactPos.x, y: contactPos.y, z: contactPos.z },
      { x: contactPos.x, y: baseHeight, z: contactPos.z },
    ];
  }

  // Path is blocked — find the obstruction and route around it
  const obstruction = validHits[0];
  const obstructionY = obstruction.point.y;

  const obstructionNormal = obstruction.face
    ? new THREE.Vector3().fromBufferAttribute(
        mesh.geometry.attributes.normal,
        obstruction.face.a
      ).normalize()
    : new THREE.Vector3(1, 0, 0);

  // Determine offset direction: move away from the obstruction surface
  // Project the normal onto XZ plane to get a horizontal escape direction
  let escapeDir = new THREE.Vector3(
    obstructionNormal.x, 0, obstructionNormal.z
  );
  if (escapeDir.length() < 0.01) {
    // Normal is straight up/down, pick arbitrary horizontal direction
    escapeDir.set(1, 0, 0);
  }
  escapeDir.normalize();

  // Calculate offset distance: enough to clear the obstruction
  let offsetDist = clearance * 2;

  // Tip segment goes straight down. Angled section starts from right below the tip.
  const tipBottom = contactPos.y - tipHeight;
  const angleStartY = Math.min(
    tipBottom - 0.1,
    obstructionY + clearance * 2
  );

  const verticalDrop = tipBottom - angleStartY;

  // Enforce max slope of 45 degrees (dy >= dx => verticalDrop >= offsetDist)
  if (offsetDist > verticalDrop) {
      if (internalSupports) {
          // Fallback to resting on the internal model
          return [
            { x: contactPos.x, y: contactPos.y, z: contactPos.z },
            { x: contactPos.x, y: obstructionY, z: contactPos.z, internalResting: true }
          ];
      }
      // Limit horizontal span to maintain 45deg
      offsetDist = verticalDrop;
  }

  // The vertical shaft drops from the angled section endpoint to the base
  const shaftX = contactPos.x + escapeDir.x * offsetDist;
  const shaftZ = contactPos.z + escapeDir.z * offsetDist;

  // Verify the offset path is clear by raycasting from the new position
  raycaster.set(
    new THREE.Vector3(shaftX, angleStartY, shaftZ),
    DOWN
  );
  raycaster.far = angleStartY;
  const shaftHits = raycaster.intersectObject(mesh);
  const shaftBlocked = shaftHits.some(h => h.point.y < angleStartY - 0.5 && h.point.y > baseHeight);

  if (shaftBlocked || offsetDist < clearance * 1.5) {
    if (internalSupports) {
        return [
          { x: contactPos.x, y: contactPos.y, z: contactPos.z },
          { x: contactPos.x, y: obstructionY, z: contactPos.z, internalResting: true }
        ];
    }
  }

  return [
    { x: contactPos.x, y: contactPos.y, z: contactPos.z },
    { x: shaftX, y: angleStartY, z: shaftZ },
    { x: shaftX, y: baseHeight, z: shaftZ },
  ];
}

/**
 * Build the geometry for a single support from a route of waypoints.
 */
function buildSupportGeometry(
  route, geometries, tipDiameter, tipHeight, pillarRadius, baseRadius, baseHeight
) {
  const top = route[0];

  // 1. Tip: tapered cone at the contact point, pointing down
  const tipGeo = new THREE.ConeGeometry(tipDiameter / 2, tipHeight, SUPPORT_SEGMENTS);
  tipGeo.translate(0, -tipHeight / 2, 0);
  tipGeo.translate(top.x, top.y, top.z);
  geometries.push(tipGeo);

  const tipBottom = top.y - tipHeight;

  // 2. Build segments between waypoints
  for (let i = 0; i < route.length - 1; i++) {
    const from = i === 0 ? { x: top.x, y: tipBottom, z: top.z } : route[i];
    const to = route[i + 1];
    const isLast = i === route.length - 2;

    // Target Y: leave room for base on last segment
    let targetY = to.y;
    if (isLast) {
      targetY = to.internalResting ? to.y + tipHeight : baseHeight;
    }

    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const dy = targetY - from.y;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);

    if (horizontalDist < 0.01) {
      // Pure vertical segment
      const segHeight = Math.abs(dy);
      if (segHeight < 0.1) continue;

      const segGeo = new THREE.CylinderGeometry(
        pillarRadius, pillarRadius, segHeight, SUPPORT_SEGMENTS
      );
      segGeo.translate(from.x, from.y + dy / 2, from.z);
      geometries.push(segGeo);
    } else {
      // Angled segment: build a cylinder aligned along the direction vector
      const segLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (segLength < 0.1) continue;

      const segGeo = new THREE.CylinderGeometry(
        pillarRadius, pillarRadius, segLength, SUPPORT_SEGMENTS
      );

      // CylinderGeometry is along Y axis by default. Rotate to align with direction.
      const dir = new THREE.Vector3(dx, dy, dz).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir);
      segGeo.applyQuaternion(quat);

      // Position at midpoint
      segGeo.translate(
        from.x + dx / 2,
        from.y + dy / 2,
        from.z + dz / 2
      );
      geometries.push(segGeo);
    }

    // If this is the last segment, add the base
    if (isLast) {
      if (to.internalResting) {
        // Bottom tip resting on model
        const bottomTipGeo = new THREE.ConeGeometry(tipDiameter / 2, tipHeight, SUPPORT_SEGMENTS);
        bottomTipGeo.rotateX(Math.PI);
        bottomTipGeo.translate(0, tipHeight / 2, 0);
        bottomTipGeo.translate(to.x, to.y, to.z);
        geometries.push(bottomTipGeo);
      } else {
        const bx = to.x;
        const bz = to.z;
        const baseGeo = new THREE.CylinderGeometry(
          pillarRadius, baseRadius, baseHeight, SUPPORT_SEGMENTS
        );
        baseGeo.translate(bx, baseHeight / 2, bz);
        geometries.push(baseGeo);
      }
    }
  }
}

/**
 * Generate structural trusses between adjacent vertical supports.
 */
function generateCrossBracing(routes, geometries, pillarRadius, baseHeight, tipHeight) {
  const shafts = [];
  
  // 1. Gather all vertical shafts
  for (const route of routes) {
    for (let i = 0; i < route.length - 1; i++) {
        const from = route[i];
        const to = route[i+1];
        
        const actualFromY = i === 0 ? from.y - tipHeight : from.y;
        let actualToY = to.y;
        
        const isLast = i === route.length - 2;
        if (isLast) {
           actualToY = to.internalResting ? to.y + tipHeight : baseHeight;
        }
        
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        const horizontalDist = Math.sqrt(dx * dx + dz * dz);
        
        // Only brace vertical segments
        if (horizontalDist < 0.01) {
            shafts.push({
                x: from.x,
                z: from.z,
                topY: Math.max(actualFromY, actualToY),
                bottomY: Math.min(actualFromY, actualToY)
            });
        }
    }
  }

  if (shafts.length < 2) return;

  // 2. Determine an appropriate search radius based on the model scale
  // By default we check up to 30mm, but if it's a huge model we might need more
  let maxBraceDist = 30; // Significantly increased base search radius
  const braceRadius = pillarRadius * 0.7;
  const zInterval = 10; // Vertical spacing between zig-zags
  
  const maxConnectionsPerShaft = 4;
  const connections = new Map();
  for (let i = 0; i < shafts.length; i++) {
    connections.set(i, 0);
  }

  // 3. Connect!
  for (let i = 0; i < shafts.length; i++) {
     if (connections.get(i) >= maxConnectionsPerShaft) continue;
     const s1 = shafts[i];
     
     // Find all potential neighbors (ignoring max distance initially)
     const neighbors = [];
     for (let j = 0; j < shafts.length; j++) {
         if (i === j) continue;
         const s2 = shafts[j];
         const dx = s2.x - s1.x;
         const dz = s2.z - s1.z;
         const dist = Math.sqrt(dx*dx + dz*dz);
         
         // Minimum distance to prevent pipes clipping inside each other
         if (dist >= pillarRadius * 2.5) {
             neighbors.push({ shaft: s2, dist: dist, index: j });
         }
     }
     
     // Sort by distance
     neighbors.sort((a, b) => a.dist - b.dist);
     
     // Try connecting to the closest ones
     let connectedCount = 0;
     for (const neighbor of neighbors) {
         if (connections.get(i) >= maxConnectionsPerShaft) break;
         if (connections.get(neighbor.index) >= maxConnectionsPerShaft) continue;
         
         // Enforce distance limit, BUT always allow at least 1 connection if it's the absolute closest neighbor
         if (neighbor.dist > maxBraceDist && connectedCount > 0) continue;

         // To avoid duplicating braces (A->B and B->A), only build if i < neighbor.index
         // But we still count the connection for both
         if (i > neighbor.index) {
             continue; 
         }
         
         const s2 = neighbor.shaft;
         
         const overlapTop = Math.min(s1.topY, s2.topY);
         const overlapBottom = Math.max(s1.bottomY, s2.bottomY);
         
         // Only connect if they have significant vertical overlap
         if (overlapTop - overlapBottom > zInterval) {
             connections.set(i, connections.get(i) + 1);
             connections.set(neighbor.index, connections.get(neighbor.index) + 1);
             connectedCount++;

             let yStart = overlapBottom + zInterval / 3;
             let direction = 1;
             while (yStart + zInterval < overlapTop) {
                const yEnd = yStart + zInterval;
                const p1 = new THREE.Vector3(s1.x, direction === 1 ? yStart : yEnd, s1.z);
                const p2 = new THREE.Vector3(s2.x, direction === 1 ? yEnd : yStart, s2.z);
                
                const braceLength = p1.distanceTo(p2);
                const braceGeo = new THREE.CylinderGeometry(braceRadius, braceRadius, braceLength, Math.max(3, SUPPORT_SEGMENTS));
                
                const dir = new THREE.Vector3().subVectors(p2, p1).normalize();
                const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir);
                braceGeo.applyQuaternion(quat);
                
                braceGeo.translate(
                    (p1.x + p2.x) / 2,
                    (p1.y + p2.y) / 2,
                    (p1.z + p2.z) / 2
                );
                
                geometries.push(braceGeo);
                
                yStart += zInterval;
                direction *= -1;
             }
         }
     }
  }
}

/**
 * Find contact points on overhang surfaces.
 */
async function findContactPoints(geometry, overhangAngleDeg, density, onProgress) {
  const pos = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;

  const overhangThreshold = Math.cos(THREE.MathUtils.degToRad(90 - overhangAngleDeg));
  const spacing = 12 - density; // density 1->11mm, density 10->2mm

  const points = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const cross = new THREE.Vector3();

  for (let i = 0; i < triCount; i++) {
    if (i % 50000 === 0 && i !== 0 && onProgress) {
      onProgress(`Finding contact points... ${Math.round((i / triCount) * 100)}%`);
      await new Promise(r => setTimeout(r, 0));
    }

    let idxA, idxB, idxC;
    if (index) {
      idxA = index.getX(i * 3);
      idxB = index.getX(i * 3 + 1);
      idxC = index.getX(i * 3 + 2);
    } else {
      idxA = i * 3;
      idxB = i * 3 + 1;
      idxC = i * 3 + 2;
    }

    a.set(pos.getX(idxA), pos.getY(idxA), pos.getZ(idxA));
    b.set(pos.getX(idxB), pos.getY(idxB), pos.getZ(idxB));
    c.set(pos.getX(idxC), pos.getY(idxC), pos.getZ(idxC));

    if (normals) {
      // Using first vertex normal as an approximation for the face
      n.set(normals.getX(idxA), normals.getY(idxA), normals.getZ(idxA)).normalize();
    } else {
      edge1.subVectors(b, a);
      edge2.subVectors(c, a);
      n.crossVectors(edge1, edge2).normalize();
    }

    const dot = n.dot(UP);
    if (dot >= -overhangThreshold) continue;

    edge1.subVectors(b, a);
    edge2.subVectors(c, a);
    cross.crossVectors(edge1, edge2);
    const area = cross.length() * 0.5;

    const numSamples = Math.max(1, Math.round(area / (spacing * spacing)));

    for (let s = 0; s < numSamples; s++) {
      let u = Math.random();
      let v = Math.random();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const w = 1 - u - v;

      const point = new THREE.Vector3(
        a.x * u + b.x * v + c.x * w,
        a.y * u + b.y * v + c.y * w,
        a.z * u + b.z * v + c.z * w,
      );

      points.push({ position: point, normal: n.clone() });
    }
  }

  return deduplicatePoints(points, spacing * 0.5);
}

/**
 * Remove points closer than minDist using spatial hash.
 */
function deduplicatePoints(points, minDist) {
  if (points.length === 0) return points;
  const cellSize = minDist;
  const grid = new Map();
  const key = (x, y, z) =>
    `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)},${Math.floor(z / cellSize)}`;

  const result = [];
  for (const p of points) {
    const k = key(p.position.x, p.position.y, p.position.z);
    if (!grid.has(k)) {
      grid.set(k, true);
      result.push(p);
    }
  }
  return result;
}

/**
 * Merge array of BufferGeometries into one.
 */
function mergeGeometries(geometries) {
  const nonIndexed = geometries.map(g => {
    const ni = g.index ? g.toNonIndexed() : g;
    ni.computeVertexNormals();
    return ni;
  });

  let totalVerts = 0;
  for (const g of nonIndexed) totalVerts += g.attributes.position.count;

  const positions = new Float32Array(totalVerts * 3);
  const normalsArr = new Float32Array(totalVerts * 3);
  let offset = 0;

  for (const g of nonIndexed) {
    const pos = g.attributes.position;
    const norm = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const idx = (offset + i) * 3;
      positions[idx] = pos.getX(i);
      positions[idx + 1] = pos.getY(i);
      positions[idx + 2] = pos.getZ(i);
      if (norm) {
        normalsArr[idx] = norm.getX(i);
        normalsArr[idx + 1] = norm.getY(i);
        normalsArr[idx + 2] = norm.getZ(i);
      }
    }
    offset += pos.count;
  }

  for (const g of geometries) g.dispose();
  for (const g of nonIndexed) { if (!geometries.includes(g)) g.dispose(); }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normalsArr, 3));
  return merged;
}
