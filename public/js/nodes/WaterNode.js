import { BaseNode } from './BaseNode.js';

/**
 * Water Node
 * Generates water systems including rivers and lakes
 * Uses A* pathfinding for realistic river flow
 */
export class WaterNode extends BaseNode {
  static inputs = ['height', 'moisture'];
  static outputs = ['output'];
  static defaultParams = {
    seaLevel: 0.4,
    numSources: 20,
    sourceSeed: 12345,
    minSourceHeight: 0.65,
    riverWidth: 1,
    flatnessThreshold: 0.02,
    meanderStrength: 0.3
  };

  async process(inputs, params) {
    if (!inputs.height) {
      throw new Error('WaterNode requires height input');
    }

    const heightMap = inputs.height;
    const moistureMap = inputs.moisture || new Float32Array(heightMap.length).fill(0.5);
    const resolution = params.resolution || 512;
    
    const seaLevel = params.seaLevel || 0.4;
    const numSources = params.numSources || 20;
    const sourceSeed = params.sourceSeed || 12345;
    const minSourceHeight = params.minSourceHeight || 0.65;
    const riverWidth = params.riverWidth || 1;
    const flatnessThreshold = params.flatnessThreshold || 0.02;
    const meanderStrength = params.meanderStrength || 0.3;

    console.log('Water node processing:', { resolution, seaLevel, numSources });

    // Water map = water surface HEIGHT
    // 0 = no water, > 0 = water surface elevation
    const waterMap = new Float32Array(heightMap.length);
    const flowAccumulation = new Uint32Array(heightMap.length); // Track river confluence
    
    let seaCount = 0;
    let riverPixels = 0;
    let lakePixels = 0;

    // 1. Mark ocean (below sea level) with flat water surface
    for (let i = 0; i < heightMap.length; i++) {
      if (heightMap[i] <= seaLevel) {
        waterMap[i] = seaLevel; // Flat ocean surface
        seaCount++;
      }
    }

    console.log(`Ocean pixels: ${seaCount} (${(seaCount/heightMap.length*100).toFixed(1)}%)`);

    // 2. Find water sources (springs on high ground)
    const sources = this.findWaterSources(
      heightMap,
      moistureMap,
      resolution,
      numSources,
      minSourceHeight,
      seaLevel,
      sourceSeed
    );

    console.log(`Found ${sources.length} water sources`);

    // 3. Trace rivers using A* pathfinding with exploration tracking
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      const sourceIdx = source.y * resolution + source.x;
      console.log(`River ${i+1}/${sources.length} from (${source.x}, ${source.y}), h=${heightMap[sourceIdx].toFixed(3)}`);
      
      const result = this.traceRiverAStar(
        source,
        heightMap,
        waterMap,
        flowAccumulation,
        resolution,
        seaLevel,
        flatnessThreshold,
        meanderStrength
      );
      
      console.log(`  Path: ${result.path.length} pixels, Explored: ${result.explored.length}, Lakes: ${result.lakes.length}`);
      riverPixels += result.path.length;
      lakePixels += result.lakes.length;
    }

    console.log('Water generation complete', {
      oceanPercent: (seaCount/heightMap.length*100).toFixed(1),
      riverPixels,
      lakePixels
    });

    return { output: waterMap };
  }

  /**
   * Find water source locations using deterministic noise
   */
  findWaterSources(heightMap, moistureMap, resolution, numSources, minHeight, seaLevel, seed) {
    const sources = [];
    const rng = this.seededRandom(seed);

    // Generate candidates from noise
    const candidates = [];
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const idx = y * resolution + x;
        const height = heightMap[idx];
        const moisture = moistureMap[idx];

        // Only consider high, moist areas ABOVE sea level
        if (height >= minHeight && height > seaLevel) {
          const score = height * moisture * rng();
          candidates.push({ x, y, score });
        }
      }
    }

    // Sort by score and take top N
    candidates.sort((a, b) => b.score - a.score);
    for (let i = 0; i < Math.min(numSources, candidates.length); i++) {
      sources.push({ x: candidates[i].x, y: candidates[i].y });
    }

    return sources;
  }

  /**
   * A* pathfinding from source to ocean with exploration tracking for lakes
   * Based on "Procedural World: Water bodies" technique
   */
  traceRiverAStar(start, heightMap, waterMap, flowAccum, resolution, seaLevel, flatnessThreshold, meanderStrength) {
    const openSet = [];
    const closedSet = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();
    const directionFrom = new Map(); // Track direction for meandering
    
    const key = (p) => `${p.x},${p.y}`;
    const idx = (p) => p.y * resolution + p.x;
    
    // Initialize
    const startKey = key(start);
    gScore.set(startKey, 0);
    fScore.set(startKey, this.heuristicToOcean(start, resolution));
    openSet.push(start);
    
    let foundPath = [];
    let exploredCells = [];
    
    while (openSet.length > 0) {
      // Get node with lowest fScore
      openSet.sort((a, b) => fScore.get(key(a)) - fScore.get(key(b)));
      const current = openSet.shift();
      const currentKey = key(current);
      const currentIdx = idx(current);
      
      closedSet.add(currentKey);
      exploredCells.push(current);
      
      // Reached ocean or existing water?
      if (waterMap[currentIdx] > 0) {
        // Reconstruct path
        foundPath = this.reconstructPath(cameFrom, current);
        break;
      }
      
      // Explore neighbors
      const neighbors = this.getNeighbors(current, resolution);
      for (const neighbor of neighbors) {
        const neighborKey = key(neighbor);
        const neighborIdx = idx(neighbor);
        
        if (closedSet.has(neighborKey)) continue;
        
        // Cost function: heavily penalize uphill
        const heightDiff = heightMap[neighborIdx] - heightMap[currentIdx];
        let moveCost;
        if (heightDiff > 0) {
          moveCost = 1000 + heightDiff * 10000; // Very expensive uphill
        } else {
          moveCost = 1 - heightDiff; // Prefer steeper downhill
        }
        
        // Add meandering cost - penalize straight lines
        const currentDirection = { dx: neighbor.x - current.x, dy: neighbor.y - current.y };
        const prevDirection = directionFrom.get(currentKey);
        
        if (prevDirection && meanderStrength > 0) {
          // Check if continuing in same direction
          if (currentDirection.dx === prevDirection.dx && currentDirection.dy === prevDirection.dy) {
            // Penalize going straight - encourage curves
            moveCost += meanderStrength;
          } else {
            // Slight reward for changing direction (meandering)
            moveCost -= meanderStrength * 0.3;
          }
        }
        
        const tentativeG = gScore.get(currentKey) + moveCost;
        
        if (!gScore.has(neighborKey) || tentativeG < gScore.get(neighborKey)) {
          cameFrom.set(neighborKey, current);
          directionFrom.set(neighborKey, currentDirection); // Store direction
          gScore.set(neighborKey, tentativeG);
          fScore.set(neighborKey, tentativeG + this.heuristicToOcean(neighbor, resolution));
          
          if (!openSet.find(n => key(n) === neighborKey)) {
            openSet.push(neighbor);
          }
        }
      }
    }
    
    // Mark river path
    for (const pos of foundPath) {
      const i = idx(pos);
      waterMap[i] = heightMap[i] + 0.01; // River surface slightly above terrain
      flowAccum[i]++;
    }
    
    // Detect lakes from explored flat areas
    const lakes = this.findLakesFromExploration(
      exploredCells,
      heightMap,
      waterMap,
      resolution,
      seaLevel,
      flatnessThreshold
    );
    
    return { path: foundPath, explored: exploredCells, lakes };
  }
  
  /**
   * Reconstruct path from A* cameFrom map
   */
  reconstructPath(cameFrom, end) {
    const path = [end];
    const key = (p) => `${p.x},${p.y}`;
    let current = end;
    
    while (cameFrom.has(key(current))) {
      current = cameFrom.get(key(current));
      path.unshift(current);
    }
    
    return path;
  }
  
  /**
   * Heuristic: Manhattan distance to nearest edge (approximation of ocean)
   */
  heuristicToOcean(pos, resolution) {
    return Math.min(pos.x, pos.y, resolution - pos.x - 1, resolution - pos.y - 1);
  }
  
  /**
   * Find lakes from A* explored cells
   * Lakes = contiguous flat areas that were explored
   */
  findLakesFromExploration(explored, heightMap, waterMap, resolution, seaLevel, flatnessThreshold) {
    const lakes = [];
    const idx = (p) => p.y * resolution + p.x;
    
    for (const cell of explored) {
      const i = idx(cell);
      
      // Skip if already water or below sea level
      if (waterMap[i] > 0 || heightMap[i] <= seaLevel) continue;
      
      // Check if this area is flat (lake basin)
      if (this.isFlatArea(cell, heightMap, resolution, flatnessThreshold)) {
        // Find the minimum height in this flat region to set lake level
        const lakeLevel = heightMap[i];
        waterMap[i] = lakeLevel; // Flat lake surface
        lakes.push(cell);
      }
    }
    
    return lakes;
  }
  
  /**
   * Check if area around cell is relatively flat
   */
  isFlatArea(pos, heightMap, resolution, threshold) {
    const idx = pos.y * resolution + pos.x;
    const centerHeight = heightMap[idx];
    const neighbors = this.getNeighbors(pos, resolution);
    
    for (const n of neighbors) {
      const nIdx = n.y * resolution + n.x;
      if (Math.abs(heightMap[nIdx] - centerHeight) > threshold) {
        return false;
      }
    }
    
    return true;
  }


  /**
   * Get valid neighbors (4-connected)
   */
  getNeighbors(pos, resolution) {
    const neighbors = [];
    const dirs = [
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 }
    ];

    for (const dir of dirs) {
      const x = pos.x + dir.dx;
      const y = pos.y + dir.dy;
      if (x >= 0 && x < resolution && y >= 0 && y < resolution) {
        neighbors.push({ x, y });
      }
    }

    return neighbors;
  }

  /**
   * Seeded random number generator
   */
  seededRandom(seed) {
    let state = seed;
    return () => {
      state = (state * 9301 + 49297) % 233280;
      return state / 233280;
    };
  }
}
