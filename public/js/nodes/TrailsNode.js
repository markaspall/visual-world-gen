import { BaseNode } from './BaseNode.js';

export class TrailsNode extends BaseNode {
  static inputs = ['features', 'height', 'gradient', 'biomes', 'water'];
  static outputs = ['trails'];
  static defaultParams = {
    maxSteepness: 0.4,
    pathReuseBonus: 0.7,
    waterCost: 10.0,
    flatTerrainBonus: 0.5,
    trailWidth: 2
  };

  async process(inputs, params) {
    const resolution = params.resolution || 512;
    const features = inputs.features;
    const heightMap = inputs.height;
    const gradientMap = inputs.gradient;
    const waterMap = inputs.water || new Float32Array(resolution * resolution).fill(0);

    console.log('TrailsNode received features:', features);
    
    if (!features || !features.length) {
      console.log('No features to connect - empty trail map');
      return { trails: new Float32Array(resolution * resolution) };
    }

    if (!heightMap || !gradientMap) {
      throw new Error('TrailsNode requires height and gradient inputs');
    }

    const maxSteepness = params.maxSteepness || 0.4;
    const pathReuseBonus = params.pathReuseBonus || 0.7;
    const waterCost = params.waterCost || 10.0;
    const flatTerrainBonus = params.flatTerrainBonus || 0.5;
    const trailWidth = params.trailWidth || 2;

    console.log('Trail pathfinding:', { 
      resolution, 
      features: features.length, 
      maxSteepness,
      sampleFeatures: features.slice(0, 3)
    });

    const startTime = performance.now();

    // Trail map: 0 = no trail, 0.3 = easy, 0.6 = moderate, 1.0 = difficult
    const trailMap = new Float32Array(resolution * resolution);
    const trailUsage = new Float32Array(resolution * resolution); // Track path reuse

    // Connect features using minimum spanning tree approach
    const connected = new Set([0]);
    const unconnected = new Set(features.map((_, i) => i).slice(1));

    while (unconnected.size > 0) {
      let bestConnection = null;
      let bestCost = Infinity;

      // Find cheapest connection from connected to unconnected
      for (const fromIdx of connected) {
        for (const toIdx of unconnected) {
          const from = features[fromIdx];
          const to = features[toIdx];
          
          // Estimate cost (Euclidean distance as heuristic)
          const dist = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2);
          
          if (dist < bestCost) {
            bestCost = dist;
            bestConnection = { fromIdx, toIdx, from, to };
          }
        }
      }

      if (bestConnection) {
        // A* pathfind between these two features
        const path = this.aStarPath(
          bestConnection.from,
          bestConnection.to,
          heightMap,
          gradientMap,
          waterMap,
          trailUsage,
          resolution,
          maxSteepness,
          pathReuseBonus,
          waterCost,
          flatTerrainBonus
        );

        // Draw trail on map
        if (path) {
          console.log(`Path found: ${path.length} steps from feature ${bestConnection.fromIdx} to ${bestConnection.toIdx}`);
          this.drawTrail(path, trailMap, trailUsage, gradientMap, resolution, trailWidth);
        } else {
          console.warn(`No path found from feature ${bestConnection.fromIdx} to ${bestConnection.toIdx}`);
        }

        connected.add(bestConnection.toIdx);
        unconnected.delete(bestConnection.toIdx);
      } else {
        break; // No more connections possible
      }
    }

    const endTime = performance.now();
    const nonZeroCount = trailMap.filter(v => v > 0).length;
    console.log(`Trail pathfinding complete in ${(endTime - startTime).toFixed(2)}ms - ${nonZeroCount} trail pixels`);

    // DEBUG: If no trails were created, add a test pattern so we know the node is working
    if (nonZeroCount === 0) {
      console.warn('⚠️ No trails generated! Adding test diagonal line...');
      for (let i = 0; i < Math.min(100, resolution); i++) {
        const idx = i * resolution + i;
        trailMap[idx] = 0.5;
      }
    }

    return { trails: trailMap };
  }

  aStarPath(start, goal, heightMap, gradientMap, waterMap, trailUsage, resolution, maxSteepness, pathReuseBonus, waterCost, flatTerrainBonus) {
    const openSet = new Set([`${start.x},${start.y}`]);
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();

    const startKey = `${start.x},${start.y}`;
    const goalKey = `${goal.x},${goal.y}`;
    
    gScore.set(startKey, 0);
    fScore.set(startKey, this.heuristic(start, goal));

    let iterations = 0;
    const maxIterations = 10000;

    while (openSet.size > 0 && iterations < maxIterations) {
      iterations++;

      // Get node with lowest fScore
      let current = null;
      let lowestF = Infinity;
      for (const key of openSet) {
        const f = fScore.get(key) || Infinity;
        if (f < lowestF) {
          lowestF = f;
          current = key;
        }
      }

      if (!current) break;

      // Reached goal?
      if (current === goalKey) {
        return this.reconstructPath(cameFrom, current);
      }

      openSet.delete(current);
      const [cx, cy] = current.split(',').map(Number);

      // Check neighbors
      const neighbors = [
        [cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1],
        [cx - 1, cy - 1], [cx + 1, cy - 1], [cx - 1, cy + 1], [cx + 1, cy + 1]
      ];

      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= resolution || ny < 0 || ny >= resolution) continue;

        const idx = ny * resolution + nx;
        const nKey = `${nx},${ny}`;

        // Calculate cost
        const gradient = gradientMap[idx];
        const water = waterMap[idx];
        const usage = trailUsage[idx];

        // Skip if too steep
        if (gradient > maxSteepness) continue;

        // Base cost (distance)
        const dx = nx - cx;
        const dy = ny - cy;
        const baseCost = Math.sqrt(dx * dx + dy * dy);

        // Terrain cost
        let terrainCost = baseCost;
        terrainCost += gradient * 2; // Steeper = more cost
        terrainCost += water > 0.01 ? waterCost : 0; // Water crossing
        terrainCost -= gradient < 0.1 ? flatTerrainBonus : 0; // Flat terrain bonus
        terrainCost -= usage > 0 ? pathReuseBonus : 0; // Reuse existing paths

        const tentativeG = (gScore.get(current) || Infinity) + terrainCost;

        if (tentativeG < (gScore.get(nKey) || Infinity)) {
          cameFrom.set(nKey, current);
          gScore.set(nKey, tentativeG);
          fScore.set(nKey, tentativeG + this.heuristic({ x: nx, y: ny }, goal));
          openSet.add(nKey);
        }
      }
    }

    return null; // No path found
  }

  heuristic(a, b) {
    return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
  }

  reconstructPath(cameFrom, current) {
    const path = [];
    while (current) {
      const [x, y] = current.split(',').map(Number);
      path.unshift({ x, y });
      current = cameFrom.get(current);
    }
    return path;
  }

  drawTrail(path, trailMap, trailUsage, gradientMap, resolution, trailWidth) {
    for (const point of path) {
      // Draw trail with width
      for (let dy = -trailWidth; dy <= trailWidth; dy++) {
        for (let dx = -trailWidth; dx <= trailWidth; dx++) {
          const x = point.x + dx;
          const y = point.y + dy;
          if (x >= 0 && x < resolution && y >= 0 && y < resolution) {
            const idx = y * resolution + x;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= trailWidth) {
              // Set trail difficulty based on gradient
              const gradient = gradientMap[idx];
              let difficulty = 0.3; // Easy
              if (gradient > 0.15) difficulty = 0.6; // Moderate
              if (gradient > 0.25) difficulty = 1.0; // Difficult

              // Blend with existing trails
              trailMap[idx] = Math.max(trailMap[idx], difficulty * (1 - dist / trailWidth));
              trailUsage[idx] += 1; // Track usage for path reuse bonus
            }
          }
        }
      }
    }
  }
}
