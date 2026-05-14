/**
 * Bridge support route-finding — searches for a nearby model surface to anchor
 * to when no path to the build plate is available.
 *
 * A bridge support has internalResting: true on its last waypoint, producing
 * tapered tips at both ends (no flared base).
 */

import * as THREE from 'three';
import {
  type RouteWaypoint,
  type RouteContext,
  type RouteOptions,
  routeCollides,
} from './supports-geometry';

// Number of azimuthal directions to sample around the contact point.
const AZIMUTH_STEPS = 16;

// Elevation angles (radians below horizontal).  Negative = below, positive = above.
// We search a hemisphere biased downward since supports prefer to rest on surfaces
// below the contact point (gravity during printing).
const ELEVATION_ANGLES = [
  -Math.PI / 2, // straight down
  -Math.PI / 3, // -60 deg
  -Math.PI / 6, // -30 deg
  -Math.PI / 12, // -15 deg
];

interface BridgeCandidate {
  route: RouteWaypoint[];
  distance: number;
  /** Bonus score — lower is better.  Penalises horizontal / upward bridges. */
  score: number;
}

/**
 * Search for a nearby model surface that a support can bridge to.
 *
 * Returns a two-waypoint route [contact, { ...target, internalResting }] if a
 * valid bridge target is found within `opts.maxBridgeSearchRadius`, or null.
 */
export function findBridgeRoute(
  contactPos: THREE.Vector3,
  context: RouteContext,
  _pillarRadius: number,
  tipHeight: number,
  baseHeight: number,
  opts: RouteOptions,
): RouteWaypoint[] | null {
  const maxDist = opts.maxBridgeSearchRadius;
  const minBridgeLength = tipHeight * 2 + 0.5;
  const raycaster = context.raycaster;

  const candidates: BridgeCandidate[] = [];
  const direction = new THREE.Vector3();

  for (const elevation of ELEVATION_ANGLES) {
    const cosEl = Math.cos(elevation);
    const sinEl = Math.sin(elevation);

    for (let a = 0; a < AZIMUTH_STEPS; a++) {
      const azimuth = (a / AZIMUTH_STEPS) * Math.PI * 2;
      direction.set(Math.cos(azimuth) * cosEl, sinEl, Math.sin(azimuth) * cosEl);

      // Offset the ray origin slightly so we don't immediately re-hit the
      // surface the contact point sits on.
      const origin = contactPos.clone().addScaledVector(direction, tipHeight * 0.5);
      raycaster.set(origin, direction);
      raycaster.near = 0;
      raycaster.far = maxDist;

      const hits = raycaster.intersectObject(context.mesh);
      if (hits.length === 0) continue;

      const hit = hits[0];
      const target = hit.point;
      const dist = contactPos.distanceTo(target);

      // Skip candidates that are too close (tips would overlap) or too far.
      if (dist < minBridgeLength || dist > maxDist) continue;

      const route: RouteWaypoint[] = [
        { x: contactPos.x, y: contactPos.y, z: contactPos.z },
        { x: target.x, y: target.y, z: target.z, internalResting: true },
      ];

      // Validate the route doesn't pierce through the model between endpoints.
      if (
        routeCollides(
          route,
          context,
          tipHeight,
          baseHeight,
          opts.supportCollisionRadius,
          opts.supportTipRadius,
        )
      ) {
        continue;
      }

      // Score: prefer shorter and more downward bridges.
      // downFraction is 1.0 for straight-down, 0.0 for horizontal, negative for upward.
      const downFraction = -direction.y;
      // Lower score = better.  Distance dominates, with a mild penalty for non-downward.
      const score = dist * (1 + (1 - downFraction) * 0.3);

      candidates.push({ route, distance: dist, score });
    }
  }

  if (candidates.length === 0) return null;

  // Return the best-scoring candidate.
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0].route;
}
