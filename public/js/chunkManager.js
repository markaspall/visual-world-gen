/**
 * Chunk Manager
 * Manages fetching, caching, and loading of infinite world chunks
 */

export class ChunkManager {
  constructor(worldId, device) {
    this.worldId = worldId;
    this.device = device;
    
    // Active chunks (keyed by "x,y,z")
    this.chunks = new Map();
    
    // Chunk loading queue
    this.loadQueue = [];
    this.loading = new Set();
    
    // Configuration
    this.maxCachedChunks = 200; // Keep 200 chunks in memory (don't evict so aggressively)
    this.chunkSize = 32; // 32x32x32 voxels
    this.loadRadius = 2; // Load chunks within 2 chunk radius (5x5x5 = 125 chunks)
    
    // Statistics
    this.stats = {
      chunksLoaded: 0,
      chunksFetched: 0,
      cacheHits: 0,
      networkErrors: 0
    };
  }

  /**
   * Get chunk key for coordinates
   */
  getChunkKey(cx, cy, cz) {
    return `${cx},${cy},${cz}`;
  }

  /**
   * Parse chunk key to coordinates
   */
  parseChunkKey(key) {
    const [cx, cy, cz] = key.split(',').map(Number);
    return { cx, cy, cz };
  }

  /**
   * Convert world position to chunk coordinates
   */
  worldToChunk(worldX, worldY, worldZ) {
    return {
      cx: Math.floor(worldX / this.chunkSize),
      cy: Math.floor(worldY / this.chunkSize),
      cz: Math.floor(worldZ / this.chunkSize)
    };
  }

  /**
   * Fetch chunk from server
   */
  async fetchChunk(cx, cy, cz) {
    const url = `/api/worlds/${this.worldId}/chunks/${cx}/${cy}/${cz}`;
    
    try {
      // Fetching chunk...
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      // Get metadata from headers
      const metadata = {
        size: parseInt(response.headers.get('Content-Length') || '0'),
        generationTime: parseInt(response.headers.get('X-Generation-Time') || '0'),
        materialNodes: parseInt(response.headers.get('X-Material-Nodes') || '0'),
        materialLeaves: parseInt(response.headers.get('X-Material-Leaves') || '0'),
        opaqueNodes: parseInt(response.headers.get('X-Opaque-Nodes') || '0'),
        opaqueLeaves: parseInt(response.headers.get('X-Opaque-Leaves') || '0')
      };
      
      const arrayBuffer = await response.arrayBuffer();
      const chunkData = this.decodeChunk(arrayBuffer);
      
      this.stats.chunksFetched++;
      
      // Chunk fetched successfully
      
      return {
        ...chunkData,
        metadata
      };
      
    } catch (error) {
      console.error(`❌ Failed to fetch chunk (${cx}, ${cy}, ${cz}):`, error);
      this.stats.networkErrors++;
      return null;
    }
  }

  /**
   * Decode binary chunk format
   */
  decodeChunk(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    let offset = 0;

    // Read header (40 bytes)
    const magic = view.getUint32(offset, true); offset += 4;
    if (magic !== 0x53564441) { // 'SVDA'
      throw new Error(`Invalid chunk magic number: ${magic.toString(16)}`);
    }

    const version = view.getUint32(offset, true); offset += 4;
    const chunkSize = view.getUint32(offset, true); offset += 4;
    const matNodeCount = view.getUint32(offset, true); offset += 4;
    const matLeafCount = view.getUint32(offset, true); offset += 4;
    const matRootIdx = view.getUint32(offset, true); offset += 4;
    const flags = view.getUint32(offset, true); offset += 4;
    const checksum = view.getUint32(offset, true); offset += 4;
    const opqRootIdx = view.getUint32(offset, true); offset += 4;
    const opqNodeCount = view.getUint32(offset, true); offset += 4;

    // Read material nodes (copy to avoid offset issues)
    const matNodes = new Uint32Array(matNodeCount);
    for (let i = 0; i < matNodeCount; i++) {
      matNodes[i] = view.getUint32(offset, true);
      offset += 4;
    }

    // Read material leaves
    const matLeaves = new Uint32Array(matLeafCount);
    for (let i = 0; i < matLeafCount; i++) {
      matLeaves[i] = view.getUint32(offset, true);
      offset += 4;
    }

    // Read opaque nodes
    const opqNodes = new Uint32Array(opqNodeCount);
    for (let i = 0; i < opqNodeCount; i++) {
      opqNodes[i] = view.getUint32(offset, true);
      offset += 4;
    }

    // Read opaque leaves
    const remainingBytes = arrayBuffer.byteLength - offset;
    const opqLeafCount = Math.floor(remainingBytes / 4);
    const opqLeaves = new Uint32Array(opqLeafCount);
    for (let i = 0; i < opqLeafCount; i++) {
      opqLeaves[i] = view.getUint32(offset, true);
      offset += 4;
    }

    return {
      version,
      chunkSize,
      materialSVDAG: {
        nodes: matNodes,
        leaves: matLeaves,
        rootIdx: matRootIdx
      },
      opaqueSVDAG: {
        nodes: opqNodes,
        leaves: opqLeaves,
        rootIdx: opqRootIdx
      }
    };
  }

  /**
   * Load chunk (fetch if needed, cache if possible)
   */
  async loadChunk(cx, cy, cz) {
    const key = this.getChunkKey(cx, cy, cz);
    
    // Already loaded?
    if (this.chunks.has(key)) {
      this.stats.cacheHits++;
      return this.chunks.get(key);
    }
    
    // Already loading?
    if (this.loading.has(key)) {
      // Wait for existing load to complete
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (this.chunks.has(key)) {
            clearInterval(checkInterval);
            resolve(this.chunks.get(key));
          }
        }, 50);
      });
    }
    
    // Mark as loading
    this.loading.add(key);
    
    try {
      // Fetch from server
      const chunkData = await this.fetchChunk(cx, cy, cz);
      
      if (chunkData) {
        // Add to cache
        this.chunks.set(key, { cx, cy, cz, ...chunkData });
        this.stats.chunksLoaded++;
        
        // Evict old chunks if cache is full
        if (this.chunks.size > this.maxCachedChunks) {
          this.evictOldChunks();
        }
        
        return this.chunks.get(key);
      }
      
      return null;
      
    } finally {
      this.loading.delete(key);
    }
  }

  /**
   * Load chunks around a world position
   * Uses sphere-based loading - loads chunks ray might intersect
   */
  async loadChunksAround(worldX, worldY, worldZ) {
    const center = this.worldToChunk(worldX, worldY, worldZ);
    const loadRadius = 3;  // 3 chunk radius = ~96 blocks view distance
    
    const chunksToLoad = [];
    
    // Load in 3D sphere (any chunk ray might traverse)
    for (let dx = -loadRadius; dx <= loadRadius; dx++) {
      for (let dy = -loadRadius; dy <= loadRadius; dy++) {
        for (let dz = -loadRadius; dz <= loadRadius; dz++) {
          const cx = center.cx + dx;
          const cy = center.cy + dy;
          const cz = center.cz + dz;
          
          // Spherical distance check
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist <= loadRadius) {
            const key = this.getChunkKey(cx, cy, cz);
            if (!this.chunks.has(key) && !this.loading.has(key)) {
              chunksToLoad.push({ cx, cy, cz, dist });
            }
          }
        }
      }
    }
    
    // Sort by distance (closest first)
    chunksToLoad.sort((a, b) => a.dist - b.dist);
    
    // Load chunks with parallelism
    const maxParallel = 8;
    for (let i = 0; i < chunksToLoad.length; i += maxParallel) {
      const batch = chunksToLoad.slice(i, i + maxParallel);
      await Promise.all(batch.map(c => this.loadChunk(c.cx, c.cy, c.cz)));
    }
    
    // Evict distant chunks
    this.evictDistantChunks(center.cx, center.cy, center.cz, loadRadius + 1);
  }

  /**
   * Evict chunks outside of view distance
   */
  evictDistantChunks(centerX, centerY, centerZ, maxDistance) {
    const toEvict = [];
    
    for (const [key, chunk] of this.chunks.entries()) {
      const dx = chunk.cx - centerX;
      const dy = chunk.cy - centerY;
      const dz = chunk.cz - centerZ;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz); // 3D distance
      
      // Evict if too far
      if (dist > maxDistance) {
        toEvict.push(key);
      }
    }
    
    for (const key of toEvict) {
      this.chunks.delete(key);
    }
  }
  
  /**
   * Evict oldest chunks to free memory
   */
  evictOldChunks() {
    const toRemove = this.chunks.size - this.maxCachedChunks + 5; // Remove 5 extra
    if (toRemove <= 0) return;
    
    // Remove oldest chunks (simple FIFO for now)
    let removed = 0;
    for (const key of this.chunks.keys()) {
      this.chunks.delete(key);
      removed++;
      if (removed >= toRemove) break;
    }
  }

  /**
   * Get all loaded chunks
   */
  getLoadedChunks() {
    return Array.from(this.chunks.values());
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      cached: this.chunks.size,
      loading: this.loading.size
    };
  }

  /**
   * Clear all chunks
   */
  clear() {
    this.chunks.clear();
    this.loading.clear();
    this.loadQueue = [];
  }
}
