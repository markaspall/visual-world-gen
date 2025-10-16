import { BaseNode } from './BaseNode.js';

/**
 * Water Node - Server-side
 * Generates water systems including oceans and basic rivers
 * Simplified version (super chunk generator handles detailed rivers)
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

    // Water map = water surface HEIGHT
    // 0 = no water, > 0 = water surface elevation
    const waterMap = new Float32Array(heightMap.length);

    // 1. Mark ocean (below sea level) with flat water surface
    for (let i = 0; i < heightMap.length; i++) {
      if (heightMap[i] <= seaLevel) {
        waterMap[i] = seaLevel; // Flat ocean surface
      }
    }

    // 2. Simple river tracing (downhill flow)
    // Note: Super chunk generator will add more detailed rivers
    const numSources = params.numSources || 20;
    const minSourceHeight = params.minSourceHeight || 0.65;
    const seed = params.sourceSeed || 12345;
    
    const sources = this.findWaterSources(heightMap, moistureMap, resolution, numSources, minSourceHeight, seaLevel, seed);

    // Trace simple downhill paths
    for (const source of sources) {
      this.traceRiverDownhill(source, heightMap, waterMap, resolution, seaLevel);
    }

    return { output: waterMap };
  }

  /**
   * Find water source locations
   */
  findWaterSources(heightMap, moistureMap, resolution, numSources, minHeight, seaLevel, seed) {
    const sources = [];
    const rng = this.seededRandom(seed);

    const candidates = [];
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const idx = y * resolution + x;
        const height = heightMap[idx];
        const moisture = moistureMap[idx];

        if (height >= minHeight && height > seaLevel) {
          const score = height * moisture * rng();
          candidates.push({ x, y, score });
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    for (let i = 0; i < Math.min(numSources, candidates.length); i++) {
      sources.push({ x: candidates[i].x, y: candidates[i].y });
    }

    return sources;
  }

  /**
   * Simple downhill river tracing
   */
  traceRiverDownhill(start, heightMap, waterMap, resolution, seaLevel) {
    let current = start;
    const visited = new Set();
    const maxSteps = 1000;

    for (let step = 0; step < maxSteps; step++) {
      const key = `${current.x},${current.y}`;
      if (visited.has(key)) break;
      visited.add(key);

      const idx = current.y * resolution + current.x;
      const currentHeight = heightMap[idx];

      // Reached sea level
      if (currentHeight <= seaLevel) {
        break;
      }

      // Mark as water
      if (waterMap[idx] === 0) {
        waterMap[idx] = currentHeight * 0.95; // Slight depression for water
      }

      // Find lowest neighbor
      let lowest = null;
      let lowestHeight = currentHeight;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;

          const nx = current.x + dx;
          const ny = current.y + dy;

          if (nx < 0 || nx >= resolution || ny < 0 || ny >= resolution) continue;

          const nidx = ny * resolution + nx;
          const nheight = heightMap[nidx];

          if (nheight < lowestHeight) {
            lowestHeight = nheight;
            lowest = { x: nx, y: ny };
          }
        }
      }

      if (!lowest) break; // Stuck in depression
      current = lowest;
    }
  }

  seededRandom(seed) {
    let value = seed;
    return () => {
      value = (value * 9301 + 49297) % 233280;
      return value / 233280;
    };
  }
}
