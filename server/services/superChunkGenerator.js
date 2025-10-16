/**
 * Super Chunk Generator
 * Generates 512x512 terrain regions for large-scale features like rivers and erosion
 */

import fs from 'fs/promises';
import path from 'path';

export class SuperChunkGenerator {
  constructor(graphExecutor) {
    this.graphExecutor = graphExecutor;
    this.cacheDir = 'storage/worlds';
  }
  
  /**
   * Generate a super chunk (512x512 region)
   * @param {string} worldId - World identifier
   * @param {number} sx - Super chunk X coordinate
   * @param {number} sz - Super chunk Z coordinate
   * @param {object} graph - Node graph definition
   * @param {object} config - World configuration (seed, materials, etc.)
   * @returns {Promise<object>} Super chunk data (heightMap, biomeMap, riverMap, blockMap)
   */
  async generate(worldId, sx, sz, graph, config) {
    console.log(`🏔️  Generating super chunk (${sx}, ${sz})...`);
    const startTime = Date.now();
    
    // 1. Check cache first
    const cached = await this.loadFromCache(worldId, sx, sz);
    if (cached) {
      console.log(`✅ Loaded from cache in ${Date.now() - startTime}ms`);
      return cached;
    }
    
    // 2. Define region in world space
    const region = {
      x: sx * 512,
      z: sz * 512,
      width: 512,
      height: 512,
      seed: config.seed || 12345
    };
    
    // 3. Execute node graph for this region
    console.log(`  📊 Executing graph for region (${region.x}, ${region.z})...`);
    const graphResults = await this.graphExecutor.execute(graph, region, config);
    console.log(`  🔍 Graph outputs:`, Object.keys(graphResults));
    
    // 4. Extract base heightmap
    const heightMap = graphResults.heightmap || new Float32Array(512 * 512);
    
    // Debug: Show heightmap range
    let minH = Infinity, maxH = -Infinity;
    for (let i = 0; i < heightMap.length; i++) {
      minH = Math.min(minH, heightMap[i]);
      maxH = Math.max(maxH, heightMap[i]);
    }
    console.log(`  🏔️  Height range: ${minH.toFixed(3)} - ${maxH.toFixed(3)}`);
    
    // 5. Generate biome map
    console.log(`  🌲 Classifying biomes...`);
    const biomeMap = graphResults.biomemap || new Uint8Array(512 * 512);
    
    // Debug: Show biome distribution
    const biomeCounts = {};
    for (let i = 0; i < biomeMap.length; i++) {
      const biomeId = biomeMap[i];
      biomeCounts[biomeId] = (biomeCounts[biomeId] || 0) + 1;
    }
    console.log(`  🌍 Biome distribution:`, biomeCounts);
    
    // 6. Generate block map
    console.log(`  🧱 Classifying blocks...`);
    const blockMap = graphResults.blockmap || new Uint16Array(512 * 512);
    
    // Debug: Show block type distribution
    const blockCounts = {};
    for (let i = 0; i < blockMap.length; i++) {
      const blockId = blockMap[i];
      blockCounts[blockId] = (blockCounts[blockId] || 0) + 1;
    }
    console.log(`  📊 Block distribution:`, blockCounts);
    
    // 7. Run river pathfinding (CPU, A* across full region)
    console.log(`  🌊 Generating rivers...`);
    const riverMap = await this.generateRivers(heightMap, biomeMap, region);
    
    // 8. Create super chunk data
    const superChunk = {
      heightMap,
      biomeMap,
      riverMap,
      blockMap,
      metadata: {
        sx, sz,
        generatedAt: Date.now(),
        generationTime: Date.now() - startTime
      }
    };
    
    // 9. Cache super chunk data
    await this.saveToCache(worldId, sx, sz, superChunk);
    
    console.log(`✅ Super chunk generated in ${Date.now() - startTime}ms`);
    return superChunk;
  }
  
  /**
   * Generate rivers using A* pathfinding
   */
  async generateRivers(heightMap, biomeMap, region) {
    const rivers = new Uint8Array(512 * 512);
    const resolution = 512;
    
    // Find mountain peaks (potential river sources)
    const peaks = this.findPeaks(heightMap, resolution);
    
    // Find low points (river destinations)
    const lowPoints = this.findLowPoints(heightMap, resolution);
    
    if (peaks.length === 0 || lowPoints.length === 0) {
      return rivers;
    }
    
    // Generate rivers from a subset of peaks
    for (const peak of peaks) {
      if (Math.random() > 0.3) continue; // Only 30% of peaks have rivers
      
      // Find nearest low point
      const target = this.findNearestLowPoint(peak, lowPoints);
      
      // A* pathfinding
      const path = this.findDownhillPath(peak, target, heightMap, resolution);
      
      // Carve river channel
      for (const pos of path) {
        rivers[pos] = 1; // Mark as river
        // Slightly lower the terrain to create channel
        heightMap[pos] = Math.max(heightMap[pos] - 0.5, 0);
      }
    }
    
    return rivers;
  }
  
  /**
   * Find peaks in heightmap (local maxima)
   */
  findPeaks(heightMap, resolution) {
    const peaks = [];
    const threshold = 0.7; // Only consider high peaks
    
    for (let y = 1; y < resolution - 1; y++) {
      for (let x = 1; x < resolution - 1; x++) {
        const idx = y * resolution + x;
        const height = heightMap[idx];
        
        if (height < threshold) continue;
        
        // Check if local maximum
        let isPeak = true;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nidx = (y + dy) * resolution + (x + dx);
            if (heightMap[nidx] >= height) {
              isPeak = false;
              break;
            }
          }
          if (!isPeak) break;
        }
        
        if (isPeak) {
          peaks.push(idx);
        }
      }
    }
    
    return peaks;
  }
  
  /**
   * Find low points (potential river destinations)
   */
  findLowPoints(heightMap, resolution) {
    const lowPoints = [];
    const threshold = 0.3; // Consider low areas
    
    for (let i = 0; i < heightMap.length; i++) {
      if (heightMap[i] < threshold) {
        lowPoints.push(i);
      }
    }
    
    return lowPoints;
  }
  
  /**
   * Find nearest low point to a peak
   */
  findNearestLowPoint(peakIdx, lowPoints) {
    const resolution = 512;
    const px = peakIdx % resolution;
    const py = Math.floor(peakIdx / resolution);
    
    let nearest = lowPoints[0];
    let minDist = Infinity;
    
    for (const lpIdx of lowPoints) {
      const lx = lpIdx % resolution;
      const ly = Math.floor(lpIdx / resolution);
      const dist = Math.abs(px - lx) + Math.abs(py - ly);
      if (dist < minDist) {
        minDist = dist;
        nearest = lpIdx;
      }
    }
    
    return nearest;
  }
  
  /**
   * Simple downhill pathfinding (greedy, not true A*)
   * TODO: Implement proper A* if needed
   */
  findDownhillPath(start, target, heightMap, resolution) {
    const path = [];
    let current = start;
    const visited = new Set();
    const maxSteps = 1000;
    
    for (let step = 0; step < maxSteps && current !== target; step++) {
      path.push(current);
      visited.add(current);
      
      const x = current % resolution;
      const y = Math.floor(current / resolution);
      const currentHeight = heightMap[current];
      
      // Find lowest neighbor
      let lowest = null;
      let lowestHeight = currentHeight;
      
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          
          const nx = x + dx;
          const ny = y + dy;
          
          if (nx < 0 || nx >= resolution || ny < 0 || ny >= resolution) continue;
          
          const nidx = ny * resolution + nx;
          if (visited.has(nidx)) continue;
          
          const nheight = heightMap[nidx];
          if (nheight < lowestHeight) {
            lowestHeight = nheight;
            lowest = nidx;
          }
        }
      }
      
      if (lowest === null) break; // Stuck
      current = lowest;
    }
    
    return path;
  }
  
  /**
   * Load super chunk from cache
   */
  async loadFromCache(worldId, sx, sz) {
    try {
      const dir = path.join(this.cacheDir, worldId, 'superchunks', `${sx}_${sz}`);
      
      const [heightMap, biomeMap, riverMap, blockMap, metadataStr] = await Promise.all([
        fs.readFile(path.join(dir, 'heightmap.bin')),
        fs.readFile(path.join(dir, 'biomemap.bin')),
        fs.readFile(path.join(dir, 'rivermap.bin')),
        fs.readFile(path.join(dir, 'blockmap.bin')),
        fs.readFile(path.join(dir, 'metadata.json'), 'utf-8')
      ]);
      
      return {
        heightMap: new Float32Array(heightMap.buffer),
        biomeMap: new Uint8Array(biomeMap.buffer),
        riverMap: new Uint8Array(riverMap.buffer),
        blockMap: new Uint16Array(blockMap.buffer),
        metadata: JSON.parse(metadataStr)
      };
    } catch (err) {
      return null; // Not cached
    }
  }
  
  /**
   * Save super chunk to cache
   */
  async saveToCache(worldId, sx, sz, superChunk) {
    const dir = path.join(this.cacheDir, worldId, 'superchunks', `${sx}_${sz}`);
    await fs.mkdir(dir, { recursive: true });
    
    await Promise.all([
      fs.writeFile(path.join(dir, 'heightmap.bin'), Buffer.from(superChunk.heightMap.buffer)),
      fs.writeFile(path.join(dir, 'biomemap.bin'), Buffer.from(superChunk.biomeMap.buffer)),
      fs.writeFile(path.join(dir, 'rivermap.bin'), Buffer.from(superChunk.riverMap.buffer)),
      fs.writeFile(path.join(dir, 'blockmap.bin'), Buffer.from(superChunk.blockMap.buffer)),
      fs.writeFile(path.join(dir, 'metadata.json'), JSON.stringify(superChunk.metadata, null, 2))
    ]);
  }
}
