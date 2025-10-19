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
    
    // Cache limits  
    this.maxCachedChunks = 5000;  // Large budget for now - meta-SVDAG will optimize later (Stage 7)
    this.chunkSize = 32; // 32x32x32 voxels
    this.loadRadius = 2; // Load chunks within 2 chunk radius (5x5x5 = 125 chunks)
    
    // Camera position for distance-based eviction
    this.cameraPosition = [0, 0, 0];
    
    // SVDAG Deduplication Pool (Stage 7a)
    this.svdagPool = new Map();  // hash → {id, nodes, leaves, refCount}
    this.nextPoolId = 0;
    
    // Adaptive eviction thresholds (for a game, not a map!)
    this.evictionThresholds = [
      60000,   // 1 minute (normal operation)
      30000,   // 30 seconds (getting full)
      15000,   // 15 seconds (very full)
      10000,   // 10 seconds (critical)
      5000     // 5 seconds (emergency)
    ];
    this.currentThresholdIndex = 0; // Start with 1 minute
    
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
   * Hash an SVDAG for deduplication
   * Uses a simple rolling hash over nodes and leaves data
   */
  hashSVDAG(nodes, leaves) {
    let hash = 0;
    
    // Hash nodes
    for (let i = 0; i < nodes.length; i++) {
      hash = ((hash << 5) - hash) + nodes[i];
      hash = hash & hash; // Convert to 32-bit int
    }
    
    // Hash leaves
    for (let i = 0; i < leaves.length; i++) {
      hash = ((hash << 5) - hash) + leaves[i];
      hash = hash & hash;
    }
    
    return hash.toString(36); // Base-36 string for Map key
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
        const now = Date.now();
        
        // Stage 7a: Hash the Material SVDAG for deduplication
        const hash = this.hashSVDAG(chunkData.materialSVDAG.nodes, chunkData.materialSVDAG.leaves);
        
        // Check if we've seen this SVDAG pattern before
        let poolId;
        if (this.svdagPool.has(hash)) {
          // DUPLICATE! Reuse existing SVDAG
          const poolEntry = this.svdagPool.get(hash);
          poolEntry.refCount++;
          poolId = poolEntry.id;
          console.log(`♻️ Dedup: Chunk (${cx},${cy},${cz}) reuses Material SVDAG #${poolId} (${poolEntry.refCount} refs)`);
        } else {
          // NEW PATTERN! Add to pool
          poolId = this.nextPoolId++;
          this.svdagPool.set(hash, {
            id: poolId,
            nodes: chunkData.materialSVDAG.nodes,
            leaves: chunkData.materialSVDAG.leaves,
            refCount: 1
          });
          console.log(`🆕 New: Chunk (${cx},${cy},${cz}) adds Material SVDAG #${poolId}`);
        }
        
        // Store chunk data with SVDAG reference
        // CRITICAL: Set timestamps AFTER spread to avoid being overwritten
        const chunkObject = {
          cx, cy, cz, 
          ...chunkData,
          svdagHash: hash,
          svdagPoolId: poolId
        };
        // Force correct timestamps (don't let server data override)
        chunkObject.loadedFrame = now;
        chunkObject.lastSeenFrame = now;
        this.chunks.set(key, chunkObject);
        
        // DEBUG: Verify timestamp was set correctly
        const storedChunk = this.chunks.get(key);
        if (!storedChunk.lastSeenFrame || storedChunk.lastSeenFrame < 1000) {
          console.error(`🐛 BUG: Chunk ${key} has invalid lastSeenFrame: ${storedChunk.lastSeenFrame} (should be ${now})`);
        }
        
        this.stats.chunksLoaded++;
        
        // NOTE: Eviction moved to renderer (once per frame, not per chunk)
        
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
   * Evict chunks using hybrid strategy:
   * 1. Always evict chunks not seen for 10 minutes (stale data)
   * 2. Primary: Distance-based eviction (far chunks)
   * 3. Secondary: Under pressure (>80%), consider LRU within distance bands
   */
  evictOldChunks(cameraPos = null) {
    if (!cameraPos) {
      console.warn('⚠️ No camera position for eviction!');
      return;
    }
    
    const now = Date.now();
    const ANCIENT_TIME = 20 * 60 * 1000;  // 20 minutes - ALWAYS evict these
    const STALE_TIME = 10 * 60 * 1000;     // 10 minutes - evict when under pressure
    const PRESSURE_THRESHOLD = 0.8;
    const EVICTION_START = 0.6;  // Start eviction at 60% full (3000/5000 chunks)
    
    // Phase 0: ALWAYS remove ancient chunks (not seen for 20+ minutes)
    // This runs regardless of buffer pressure - safety valve
    const ancientChunks = [];
    for (const [key, chunk] of this.chunks.entries()) {
      // Safety check: if lastSeenFrame is missing or invalid, set it to now
      if (!chunk.lastSeenFrame || typeof chunk.lastSeenFrame !== 'number') {
        chunk.lastSeenFrame = now;
        continue;  // Don't evict chunks with fixed timestamps
      }
      
      // Defensive: Fix clearly invalid timestamps (< 1 year since epoch = corrupted)
      const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
      if (chunk.lastSeenFrame < ONE_YEAR_MS) {
        // Silently fix corrupt timestamps (TODO: fix root cause)
        chunk.lastSeenFrame = now;
        continue;  // Don't evict, just fixed it
      }
      
      const age = now - chunk.lastSeenFrame;
      
      // Defensive: Never evict chunks less than 1 second old (prevents timestamp bugs)
      if (age < 1000) {
        continue;  // Skip recently loaded chunks
      }
      
      if (age > ANCIENT_TIME) {
        ancientChunks.push(key);
        console.log(`  Ancient chunk ${key}: ${(age / 60000).toFixed(1)} minutes old (lastSeen: ${chunk.lastSeenFrame}, now: ${now})`);
      }
    }
    
    for (const key of ancientChunks) {
      const chunk = this.chunks.get(key);
      
      // Stage 7a: Decrement SVDAG refcount
      if (chunk && chunk.svdagHash) {
        const poolEntry = this.svdagPool.get(chunk.svdagHash);
        if (poolEntry) {
          poolEntry.refCount--;
          if (poolEntry.refCount === 0) {
            this.svdagPool.delete(chunk.svdagHash);
            console.log(`  🗑️ SVDAG #${poolEntry.id} freed (no more refs)`);
          }
        }
      }
      
      this.chunks.delete(key);
    }
    
    if (ancientChunks.length > 0) {
      console.log(`🗑️ Evicted ${ancientChunks.length} ancient chunks (not seen for 20+ minutes)`);
    }
    
    // Phase 1: Check if we should start evicting based on pressure
    const softLimit = Math.floor(this.maxCachedChunks * EVICTION_START);
    const toRemove = this.chunks.size - softLimit;
    if (toRemove <= 0) {
      return ancientChunks.length;  // Below soft limit, but return ancient count
    }
    
    // Phase 2: We're over soft limit - check for stale chunks ONLY if at high capacity
    const staleChunks = [];
    
    if (this.chunks.size > this.maxCachedChunks * 0.9) {  // Only when 90%+ full
      for (const [key, chunk] of this.chunks.entries()) {
        if (now - chunk.lastSeenFrame > STALE_TIME) {
          staleChunks.push(key);
        }
      }
      
      for (const key of staleChunks) {
        this.chunks.delete(key);
      }
      
      if (staleChunks.length > 0) {
        console.log(`🗑️ Evicted ${staleChunks.length} stale chunks (not seen for 10+ minutes)`);
      }
    }
    
    // Phase 3: Check if stale eviction was enough
    const stillToRemove = this.chunks.size - this.maxCachedChunks;
    if (stillToRemove <= 0) {
      return staleChunks.length;  // Stale eviction was enough
    }
    
    // Don't evict too aggressively - max 50 chunks per frame
    const actualTarget = Math.min(toRemove, 50);
    const pressure = this.getMemoryPressure();
    const highPressure = pressure > PRESSURE_THRESHOLD;
    
    const camChunk = this.worldToChunk(cameraPos[0], cameraPos[1], cameraPos[2]);
    
    // Score all chunks
    const scored = Array.from(this.chunks.entries()).map(([key, chunk]) => {
      const dx = chunk.cx - camChunk.cx;
      const dy = chunk.cy - camChunk.cy;
      const dz = chunk.cz - camChunk.cz;
      const distSq = dx*dx + dy*dy + dz*dz;
      const distance = Math.sqrt(distSq);
      
      // Hybrid scoring:
      // - Primary: Distance (always matters)
      // - Secondary: Last seen time (only under pressure)
      let score = distSq * 1000;  // Distance is primary factor
      
      if (highPressure) {
        // Under pressure: Also consider how recently chunk was seen
        const timeSinceView = now - chunk.lastSeenFrame;
        const ageBonus = timeSinceView / 1000;  // Bonus points for old chunks
        score += ageBonus * 100;  // Weight: distance matters 10x more than age
      }
      
      return { key, distance, score, lastSeen: (now - chunk.lastSeenFrame) / 1000 };
    });
    
    // Sort by score (highest = worst = evict first)
    scored.sort((a, b) => b.score - a.score);
    
    // Remove worst chunks
    const removed = [];
    for (let i = 0; i < actualTarget; i++) {
      const chunk = this.chunks.get(scored[i].key);
      
      // Stage 7a: Decrement SVDAG refcount
      if (chunk && chunk.svdagHash) {
        const poolEntry = this.svdagPool.get(chunk.svdagHash);
        if (poolEntry) {
          poolEntry.refCount--;
          if (poolEntry.refCount === 0) {
            this.svdagPool.delete(chunk.svdagHash);
            console.log(`  🗑️ SVDAG #${poolEntry.id} freed (no more refs)`);
          }
        }
      }
      
      this.chunks.delete(scored[i].key);
      removed.push({
        dist: scored[i].distance.toFixed(1),
        age: scored[i].lastSeen.toFixed(1)
      });
    }
    
    // Log eviction
    if (removed.length > 0) {
      const strategy = highPressure ? 'distance+LRU' : 'distance';
      const sample = removed.slice(0, 3).map(r => `${r.dist}ch/${r.age}s`).join(', ');
      console.log(`🗑️ Evicted ${removed.length} chunks (${strategy}): ${sample} | ${this.chunks.size} remain`);
    }
    
    // Return total evicted count (ancient + stale + distance-based)
    return ancientChunks.length + staleChunks.length + removed.length;
  }

  /**
   * Update camera position for distance-based eviction
   */
  updateCameraPosition(x, y, z) {
    this.cameraPosition = [x, y, z];
  }

  /**
   * Get memory pressure (0.0 = plenty of room, 1.0 = at limit)
   */
  getMemoryPressure() {
    return Math.min(1.0, this.chunks.size / this.maxCachedChunks);
  }

  /**
   * Get current eviction threshold in seconds
   */
  getCurrentEvictionThreshold() {
    return this.evictionThresholds[this.currentThresholdIndex] / 1000;
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
