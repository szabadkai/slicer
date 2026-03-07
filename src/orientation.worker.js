import * as THREE from 'three';

// --- Worker State & Helpers ---

const UP = new THREE.Vector3(0, 1, 0);

// Generate the 26 base candidate directions to seed the population
function generateCandidates() {
  const dirs = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue;
        const dir = new THREE.Vector3(x, y, z).normalize();
        
        // Convert direction to quaternion rotating Y-up to this dir
        const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
        dirs.push(q);
      }
    }
  }
  return dirs;
}

const BASE_CANDIDATES = generateCandidates();

// Fast random number generator
function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

// Generate a completely random orientation
function randomOrientation() {
  const quaternion = new THREE.Quaternion();
  // Math.random() is sufficient for this GA
  const u1 = Math.random();
  const u2 = Math.random();
  const u3 = Math.random();

  const sqrt1u1 = Math.sqrt(1 - u1);
  const sqrtu1 = Math.sqrt(u1);

  quaternion.set(
    sqrt1u1 * Math.sin(2.0 * Math.PI * u2),
    sqrt1u1 * Math.cos(2.0 * Math.PI * u2),
    sqrtu1 * Math.sin(2.0 * Math.PI * u3),
    sqrtu1 * Math.cos(2.0 * Math.PI * u3)
  );
  return quaternion;
}

// Memory-reused vectors for the fitness function
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _edge1 = new THREE.Vector3();
const _edge2 = new THREE.Vector3();
const _cross = new THREE.Vector3();

// --- GA Engine ---

/**
 * Returns fitness metrics for a given quaternion.
 * We rotate the model logically by transforming the "Up" vector down into local space
 * instead of rotating all vertices, which is much faster.
 */
function evaluateFitness(positionArray, normalArray, triCount, quaternion, overhangThreshold) {
  // Instead of rotating the model, we rotate the UP vector by the INVERSE quaternion
  // to get the local "Up" direction for this candidate orientation.
  const inverseQ = quaternion.clone().invert();
  const localUp = UP.clone().applyQuaternion(inverseQ);

  let overhangArea = 0;
  let totalHeight = 0;
  let staircaseMetric = 0;
  let flatBottomArea = 0;

  // 1. Calculate height on this local UP axis
  let minProj = Infinity, maxProj = -Infinity;
  for (let i = 0; i < positionArray.length; i += 3) {
    _v.set(positionArray[i], positionArray[i+1], positionArray[i+2]);
    const proj = _v.dot(localUp);
    if (proj < minProj) minProj = proj;
    if (proj > maxProj) maxProj = proj;
  }
  totalHeight = maxProj - minProj;

  // 2. Iterate faces to calculate support/staircase metrics
  for (let i = 0; i < triCount; i++) {
    const idx = i * 9; // 3 vertices * 3 coords
    
    _a.set(positionArray[idx], positionArray[idx+1], positionArray[idx+2]);
    _b.set(positionArray[idx+3], positionArray[idx+4], positionArray[idx+5]);
    _c.set(positionArray[idx+6], positionArray[idx+7], positionArray[idx+8]);

    if (normalArray) {
        _n.set(normalArray[idx], normalArray[idx+1], normalArray[idx+2]);
    } else {
        _edge1.subVectors(_b, _a);
        _edge2.subVectors(_c, _a);
        _n.crossVectors(_edge1, _edge2).normalize();
    }

    _edge1.subVectors(_b, _a);
    _edge2.subVectors(_c, _a);
    _cross.crossVectors(_edge1, _edge2);
    const area = _cross.length() * 0.5;

    // Dot product of face normal with local up direction
    const dot = _n.dot(localUp);

    if (dot < -overhangThreshold) {
        // Face points downward.
        // Weight by how flat it is (closer to -1 means steeper overhang)
        // and its height from the bottom to estimate support volume.
        
        // Approximate the center of the face
        _v.copy(_a).add(_b).add(_c).divideScalar(3);
        const heightFromBottom = _v.dot(localUp) - minProj;
        
        // Volume rough estimate: Area * Z-projected height
        // We multiply by Math.abs(dot) because a perfectly flat surface projecting down
        // requires more continuous supports than a steep angled one.
        overhangArea += area * heightFromBottom * Math.abs(dot);
    }

    if (dot < -0.99) {
      flatBottomArea += area;
    }

    const absDot = Math.abs(dot);
    if (absDot > 0.1 && absDot < 0.5) {
      staircaseMetric += area * (0.5 - absDot);
    }
  }

  return { overhangArea, totalHeight, staircaseMetric, flatBottomArea };
}

function calculateScore(metrics, preset) {
  const { overhangArea, totalHeight, staircaseMetric, flatBottomArea } = metrics;
  
  // Note: overhangArea here is an estimate of *Volume* (Area * Height), 
  // so its numerical value is much larger than totalHeight.
  // We need to carefully balance the weights.
  
  switch (preset) {
    case 'fastest':
      // Heaviest weight on height. A small penalty for supports so it doesn't 
      // pick a completely ridiculous orientation that takes just as long due to supports.
      // E.g. totalHeight is ~50-150. overhangArea can be 1000-50000.
      return -(totalHeight * 1000) - overhangArea + (flatBottomArea * 10); 
      
    case 'least-support':
      // Only care about minimizing support volume. Height is largely ignored
      // unless two orientations have identical support volume.
      return -(overhangArea * 1000) - totalHeight + (flatBottomArea * 500);
      
    case 'best-quality':
      // Heavily penalize both supports and stair-stepping on gently sloped surfaces.
      // Staircase metric should be heavily avoided as it creates ugly visual artifacts.
      return -(overhangArea * 500) - (staircaseMetric * 5000) - totalHeight + (flatBottomArea * 500);
      
    default:
      return -overhangArea;
  }
}

/**
 * Main GA loop
 */
function runGeneticAlgorithm(positionArray, normalArray, triCount, preset, popSize, generations) {
  const overhangThreshold = Math.cos(THREE.MathUtils.degToRad(30)); 
  
  // 1. Evaluate base candidates first
  postMessage({ type: 'progress', progress: 0.05, message: 'Evaluating base orientations...' });

  let bestBaseCandidate = { q: new THREE.Quaternion(), score: -Infinity };
  
  for (const baseQ of BASE_CANDIDATES) {
      const metrics = evaluateFitness(positionArray, normalArray, triCount, baseQ, overhangThreshold);
      const score = calculateScore(metrics, preset);
      if (score > bestBaseCandidate.score) {
          bestBaseCandidate = { q: baseQ.clone(), score };
      }
  }

  // 2. Initialize population
  let population = [];
  
  // Inject the best base direction
  population.push(bestBaseCandidate);

  // Inject the identity quaternion (current orientation) to ensure we evaluate the user's starting point
  population.push({ q: new THREE.Quaternion(), score: -Infinity });
  
  // Fill the rest with random orientations
  while(population.length < popSize) {
      population.push({ q: randomOrientation(), score: -Infinity });
  }

  let globalBestScore = -Infinity;
  let generationsWithoutImprovement = 0;
  const PATIENCE = 5; // Stop if no improvement after 5 generations

  // 2. Evolution
  for (let gen = 0; gen < generations; gen++) {
      
      // Evaluate all that need it
      let bestScoreInGen = -Infinity;
      for (const individual of population) {
          if (individual.score === -Infinity) {
              const metrics = evaluateFitness(positionArray, normalArray, triCount, individual.q, overhangThreshold);
              individual.score = calculateScore(metrics, preset);
          }
          if (individual.score > bestScoreInGen) {
              bestScoreInGen = individual.score;
          }
      }
      
      // Sort descending (highest score best)
      population.sort((a, b) => b.score - a.score);
      
      // Check for early stopping
      const currentBest = population[0].score;
      // Use a small epsilon to avoid lingering on microscopic floating point updates
      if (currentBest > globalBestScore + 0.001) {
          globalBestScore = currentBest;
          generationsWithoutImprovement = 0;
      } else {
          generationsWithoutImprovement++;
      }

      // Report progress
      postMessage({
          type: 'progress',
          progress: (gen + 1) / generations, // Slightly under-reports if early stop, but accurate enough
          message: `GA Generation ${gen+1}/${generations}`
      });

      if (generationsWithoutImprovement >= PATIENCE) {
          postMessage({
              type: 'progress',
              progress: 1.0,
              message: `Early stopping at generation ${gen+1}`
          });
          break; // Exit the evolution loop early
      }
      
      const newPopulation = [];
      const eliteCount = Math.max(2, Math.floor(popSize * 0.1));
      
      // Elitism: keep the best untouched
      for (let i = 0; i < eliteCount; i++) {
          newPopulation.push(population[i]);
      }
      
      // Tournament selection
      const selectParent = () => {
          const tournamentSize = 3;
          let best = population[Math.floor(Math.random() * popSize)];
          for(let i=1; i<tournamentSize; i++) {
              const candidate = population[Math.floor(Math.random() * popSize)];
              if (candidate.score > best.score) best = candidate;
          }
          return best;
      };
      
      // Generate offspring
      while (newPopulation.length < popSize) {
          const parentA = selectParent();
          let parentB = selectParent();
          
          while (parentA === parentB && popSize > 1) {
              parentB = selectParent();
          }
          
          const childQ = new THREE.Quaternion();
          
          // Crossover: Slerp between parents
          const t = Math.random();
          childQ.slerpQuaternions(parentA.q, parentB.q, t);
          
          // Mutation: Jitter by random angle
          if (Math.random() < 0.2) { // 20% mutation rate
              const mutationAxis = new THREE.Vector3(
                  randomRange(-1, 1),
                  randomRange(-1, 1),
                  randomRange(-1, 1)
              ).normalize();
              // Mutate by up to 15 degrees
              const mutationAngle = randomRange(-0.26, 0.26); 
              const mutationQ = new THREE.Quaternion().setFromAxisAngle(mutationAxis, mutationAngle);
              childQ.multiply(mutationQ);
              childQ.normalize();
          }
          
          newPopulation.push({ q: childQ, score: -Infinity });
      }
      
      population = newPopulation;
  }
  
  // Final evaluation of last generation
  for (const individual of population) {
      if (individual.score === -Infinity) {
          const metrics = evaluateFitness(positionArray, normalArray, triCount, individual.q, overhangThreshold);
          individual.score = calculateScore(metrics, preset);
      }
  }
  population.sort((a, b) => b.score - a.score);
  
  // Best orientation must also rotate the Up vector properly to Y-up
  // Because we applied inverse transform, the optimal localUp is what we want.
  const bestCandidate = population[0];
  
  // Compute quaternion to rotate best local up to align with world Y-up
  const bestLocalUp = UP.clone().applyQuaternion(bestCandidate.q.clone().invert());
  
  const finalQuaternion = new THREE.Quaternion();
  finalQuaternion.setFromUnitVectors(bestLocalUp, UP);
  
  return finalQuaternion;
}

// --- Worker Message Handler ---

onmessage = function(e) {
  const { type } = e.data;
  
  if (type === 'optimize') {
      const { positionArray, normalArray, preset, triCount } = e.data;
      
      // GA Parameters tuned for responsive performance
      // Base seeds (26) + Current (1) + Random (23) = 50 
      const popSize = 50; 
      // 20 generations is usually plenty for convergence, especially with early stopping
      const generations = 20; 
      
      postMessage({ type: 'progress', progress: 0, message: 'Initializing GA...' });
      
      const bestQ = runGeneticAlgorithm(positionArray, normalArray, triCount, preset, popSize, generations);
      
      postMessage({ 
          type: 'complete', 
          quaternion: bestQ.toArray() 
      });
  }
};
