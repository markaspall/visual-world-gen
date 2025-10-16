# Server-Side SVDAG Chunk Generation - Design Document

**Date:** October 14, 2025  
**Objective:** Transform client-side monolithic world generation into server-side chunk-based streaming system

---

## Executive Summary

Upgrade the system to generate world data in **super chunks** (512×512 regions) for terrain/rivers/erosion, then subdivide into 32×32×32 SVDAG chunks for streaming. The server will execute the node graph, build terrain data at super chunk scale, then extract and cache individual chunks for client rendering.

**Key Targets:**
- **Super Chunk Size:** 512×512×H voxels (terrain generation unit)
- **Stream Chunk Size:** 32×32×32 voxels (SVDAG streaming unit)
- **Chunks per Super Chunk:** 16×16 = 256 stream chunks per super chunk
- **Format:** Binary SVDAG (nodes + leaves buffers)
- **Size:** 5-50KB per stream chunk (compressed)
- **Generation Time:** 2-5s per super chunk, 50-200ms per stream chunk (cached)
- **Cache Hit Rate:** 95%+ (chunks rarely regenerated)

---

## 1. Current Architecture

### Data Flow
```
Client (index.ejs) → Node Graph Editor
    ↓
Pipeline Manager → Execute 28 node types (WebGPU)
    ↓
Export → Save heightmaps as PNG to server
    ↓
World Viewer → Load PNGs, build 256³ SVDAG, render
```

### Current Limitations
- ❌ 5-10 second SVDAG build on client
- ❌ 100-500MB memory per world
- ❌ No streaming or LOD
- ❌ Entire world must be regenerated on changes

---

## 2. Proposed Architecture

### New Data Flow (Two-Tier System)
```
Client requests stream chunk (32³) at coordinate (cx, cy, cz)
    ↓
Server determines which super chunk (512×512) it belongs to
    ↓
┌─────────────────────────────────────────────────────┐
│ SUPER CHUNK GENERATION (if not cached)             │
│   ↓                                                 │
│ Graph Executor → Run nodes for 512×512 region      │
│   ↓                                                 │
│ Water/Rivers → Pathfinding across full region      │
│   ↓                                                 │
│ Erosion → Simulate across full region              │
│   ↓                                                 │
│ Cache super chunk heightmaps (512×512 2D arrays)   │
└─────────────────────────────────────────────────────┘
    ↓
Extract 32×32×32 voxel region from super chunk data
    ↓
Build SVDAG for stream chunk
    ↓
Cache stream chunk (32³ SVDAG)
    ↓
Client ← Binary SVDAG chunk
```

### Two-Tier Coordinate System

**Super Chunks (Terrain Generation):**
- Size: 512×512×H voxels (H = max height, e.g., 256)
- Purpose: Large-scale features (rivers, erosion, biomes)
- Super chunk coordinate: `(sx, sz)` (2D, no Y component)
- World position `(wx, wz)` → Super chunk `(floor(wx/512), floor(wz/512))`

**Stream Chunks (SVDAG Rendering):**
- Size: 32×32×32 voxels
- Purpose: GPU rendering, streaming, LOD
- Stream chunk coordinate: `(cx, cy, cz)` (3D)
- World position `(wx, wy, wz)` → Stream chunk `(floor(wx/32), floor(wy/32), floor(wz/32))`

**Relationship:**
```
Stream chunk (cx, cy, cz) belongs to super chunk:
  sx = floor(cx / 16)  // 16 stream chunks per super chunk axis
  sz = floor(cz / 16)
  
Super chunk (sx, sz) contains stream chunks:
  cx ∈ [sx*16, sx*16+15]
  cz ∈ [sz*16, sz*16+15]
  cy ∈ [0, 7] (assuming 256 max height / 32)
```

**Example:**
- Stream chunk (0, 0, 0) → Super chunk (0, 0)
- Stream chunk (15, 3, 15) → Super chunk (0, 0)
- Stream chunk (16, 0, 0) → Super chunk (1, 0)
- Stream chunk (20, 5, 35) → Super chunk (1, 2)

---

## 3. API Design

### 3.1 Chunk Endpoint

**Route:** `GET /api/worlds/:worldId/chunks/:x/:y/:z`

**Response (Binary):**
```
Content-Type: application/octet-stream
X-Chunk-Size: 32
X-Node-Count: 1234
X-Leaf-Count: 567

[Binary Data]:
  Header (32 bytes)
    - magic: 0x53564441 ('SVDA')
    - version: 1
    - chunkSize: 32
    - nodeCount, leafCount, rootIdx
  Nodes Section (nodeCount entries)
    - [tag, childMask/leafIdx, child0, ...]
  Leaves Section (leafCount × u32)
    - [blockId, blockId, ...]
```

### 3.2 World Manifest

**Route:** `GET /api/worlds/:worldId/manifest`

**Response:**
```json
{
  "worldId": "world_123",
  "seed": 1234567890,
  "worldSize": { "voxels": [512,256,512], "meters": [170,85,170] },
  "chunkSize": 32,
  "chunkGrid": [16,8,16],
  "materials": [ { "id": 1, "name": "Grass", "color": [0.27,0.71,0.27] } ],
  "spawnPoint": [85, 140, 85]
}
```

---

## 4. Super Chunk Generation Details

### 4.1 Why Super Chunks?

**Problem:** Some terrain features require large-scale context:
- **Rivers:** Need pathfinding from mountains to ocean (512+ units)
- **Erosion:** Sediment transport across entire region
- **Biome transitions:** Smooth gradients over large areas
- **Road/trail networks:** Connect distant points

**Solution:** Generate terrain at 512×512 scale, cache results, extract 32³ chunks on demand.

### 4.2 Super Chunk Generation Pipeline

```javascript
async function generateSuperChunk(worldId, sx, sz, graph, config) {
  // 1. Execute node graph for 512×512 region
  const region = {
    x: sx * 512,
    z: sz * 512,
    width: 512,
    height: 512
  };
  
  // 2. Generate base heightmap (GPU accelerated)
  const heightMap = await executeGraph(graph, region); // 512×512 Float32Array
  
  // 3. Generate biome map
  const biomeMap = await biomeClassifier(heightMap); // 512×512 Uint8Array
  
  // 4. Run river pathfinding (CPU, A* across full region)
  const riverMap = await generateRivers(heightMap, biomeMap); // 512×512 Uint8Array
  
  // 5. Apply erosion simulation (GPU compute shader, multiple passes)
  const erodedHeight = await applyErosion(heightMap, riverMap, 100); // 100 iterations
  
  // 6. Generate block types
  const blockMap = await blockClassifier(erodedHeight, biomeMap, riverMap);
  
  // 7. Cache super chunk data
  await cacheSuperChunk(worldId, sx, sz, {
    heightMap: erodedHeight,
    biomeMap,
    riverMap,
    blockMap
  });
  
  return { heightMap: erodedHeight, biomeMap, riverMap, blockMap };
}
```

### 4.3 River Pathfinding Example

```javascript
async function generateRivers(heightMap, biomeMap) {
  const rivers = new Uint8Array(512 * 512);
  const resolution = 512;
  
  // Find mountain peaks (start points)
  const peaks = findPeaks(heightMap, resolution);
  
  // Find ocean/lakes (end points)
  const oceans = findOceans(biomeMap, resolution);
  
  // A* pathfinding for each river
  for (const peak of peaks) {
    if (Math.random() > 0.3) continue; // Not all peaks have rivers
    
    const path = await aStarPath(
      peak,
      oceans,
      heightMap,
      resolution,
      (from, to) => {
        // Cost function: prefer downhill, avoid steep
        const heightDiff = heightMap[to] - heightMap[from];
        return heightDiff > 0 ? 100 : 1; // Uphill is expensive
      }
    );
    
    // Carve river channel
    for (const pos of path) {
      rivers[pos] = 6; // Water block ID
      heightMap[pos] = Math.min(heightMap[pos], getWaterLevel(pos));
    }
  }
  
  return rivers;
}
```

### 4.4 Erosion Simulation Example

```javascript
async function applyErosion(heightMap, riverMap, iterations) {
  // GPU compute shader for erosion
  const erosionShader = `
    @group(0) @binding(0) var<storage, read> heightIn: array<f32>;
    @group(0) @binding(1) var<storage, read_write> heightOut: array<f32>;
    @group(0) @binding(2) var<storage, read> rivers: array<u32>;
    
    @compute @workgroup_size(16, 16)
    fn main(@builtin(global_invocation_id) id: vec3<u32>) {
      let x = id.x;
      let y = id.y;
      if (x >= 512u || y >= 512u) { return; }
      
      let idx = y * 512u + x;
      let height = heightIn[idx];
      
      // Calculate erosion from neighbors
      var minNeighbor = height;
      for (var dy = -1i; dy <= 1i; dy++) {
        for (var dx = -1i; dx <= 1i; dx++) {
          let nx = i32(x) + dx;
          let ny = i32(y) + dy;
          if (nx >= 0 && nx < 512 && ny >= 0 && ny < 512) {
            let nidx = u32(ny * 512 + nx);
            minNeighbor = min(minNeighbor, heightIn[nidx]);
          }
        }
      }
      
      // Erode if we're higher than neighbors
      let erosionRate = 0.01; // 1% per iteration
      let hasRiver = rivers[idx] > 0u;
      let rate = select(erosionRate, erosionRate * 3.0, hasRiver); // Rivers erode 3× faster
      
      heightOut[idx] = mix(height, minNeighbor, rate);
    }
  `;
  
  // Run multiple iterations
  let current = heightMap;
  for (let i = 0; i < iterations; i++) {
    current = await runErosionPass(erosionShader, current, riverMap);
  }
  
  return current;
}
```

### 4.5 Stream Chunk Extraction

```javascript
async function extractStreamChunk(superChunk, cx, cy, cz) {
  // Stream chunk (cx, cy, cz) is at voxel position:
  const voxelX = cx * 32;
  const voxelY = cy * 32;
  const voxelZ = cz * 32;
  
  // Which super chunk does this belong to?
  const sx = Math.floor(cx / 16);
  const sz = Math.floor(cz / 16);
  
  // Local position within super chunk (0-511)
  const localX = voxelX - sx * 512;
  const localZ = voxelZ - sz * 512;
  
  // Build 32³ voxel grid from super chunk 2D data
  const voxelGrid = new Uint32Array(32 * 32 * 32);
  
  for (let z = 0; z < 32; z++) {
    for (let x = 0; x < 32; x++) {
      const superIdx = (localZ + z) * 512 + (localX + x);
      const terrainHeight = superChunk.heightMap[superIdx];
      const blockType = superChunk.blockMap[superIdx];
      const waterLevel = superChunk.riverMap[superIdx] ? 50 : 0; // Example
      
      // Fill vertical column
      for (let y = 0; y < 32; y++) {
        const worldY = voxelY + y;
        const voxelIdx = z * 32 * 32 + y * 32 + x;
        
        if (worldY < terrainHeight) {
          voxelGrid[voxelIdx] = blockType; // Solid terrain
        } else if (worldY < waterLevel) {
          voxelGrid[voxelIdx] = 6; // Water
        } else {
          voxelGrid[voxelIdx] = 0; // Air
        }
      }
    }
  }
  
  // Build SVDAG from voxel grid
  const svdag = buildSVDAG(voxelGrid, 32);
  
  return svdag;
}
```

### 4.6 Caching Strategy

**Two-Level Cache:**

**Level 1: Super Chunk Cache**
```
storage/worlds/{worldId}/superchunks/{sx}_{sz}/
  ├── heightmap.bin      (512×512 Float32Array = 1MB)
  ├── biomemap.bin       (512×512 Uint8Array = 256KB)
  ├── rivermap.bin       (512×512 Uint8Array = 256KB)
  ├── blockmap.bin       (512×512 Uint16Array = 512KB)
  └── metadata.json      (generation time, version, etc.)

Total: ~2MB per super chunk
```

**Level 2: Stream Chunk Cache**
```
storage/worlds/{worldId}/chunks/{cx}_{cy}_{cz}.svdag
  Binary SVDAG (5-50KB)
```

**Cache Hit Scenarios:**

1. **Both cached (95% of requests):**
   - Load stream chunk SVDAG from disk: ~5ms
   - Total: 5ms ✅

2. **Stream chunk missing, super chunk cached (4% of requests):**
   - Load super chunk data: ~50ms (2MB from disk)
   - Extract 32³ region: ~5ms
   - Build SVDAG: ~50ms
   - Cache stream chunk: ~5ms
   - Total: ~110ms

3. **Super chunk missing (1% of requests):**
   - Generate super chunk: ~2-5s (rivers, erosion)
   - Cache super chunk: ~100ms
   - Extract stream chunk: ~50ms
   - Build SVDAG: ~50ms
   - Cache stream chunk: ~5ms
   - Total: ~2.2-5.2s (only on first access)

**Preloading Strategy:**
- When player spawns, pre-generate super chunks in 3×3 grid around spawn
- Background task generates adjacent super chunks
- Target: 95%+ cache hit rate after initial load

---

## 5. Technical Requirements

### 5.1 Server Components

#### Super Chunk Generator
- **Input:** Graph definition, super chunk coordinate (sx, sz)
- **Output:** 512×512 heightmap, biome map, river map, block map
- **Performance:** 2-5s per super chunk (includes pathfinding + erosion)
- **Caching:** Persistent disk cache (2MB per super chunk)

#### Stream Chunk Generator
- **Input:** Super chunk data, stream chunk coordinate (cx, cy, cz)
- **Output:** 32³ SVDAG (binary format)
- **Performance:** 50ms per stream chunk
- **Caching:** Persistent disk cache (5-50KB per chunk)

#### Graph Executor (Updated)
- **Port all 28 nodes to server-side** (currently client WebGPU)
- Execute for 512×512 regions (not 32×32)
- **Technology:** Node.js WebGPU via `@webgpu/node`
- **Challenge:** Test first (see NODEJS_WEBGPU_TEST.md)

#### SVDAG Builder
- **Reuse existing:** `SVDAGBuilder` class from `svdagRenderer.js`
- Input: Uint32Array(32³) voxel grid
- Output: `{ nodesBuffer, leavesBuffer, rootIdx }`
- **Performance:** <50ms per chunk (CPU)

#### Chunk Cache
- **File System:** `storage/worlds/{worldId}/chunks/{x}_{y}_{z}.svdag`
- **Redis** (optional): Hot chunk cache (1hr TTL)
- **Database** (optional): Chunk versioning/history

### 4.2 Client Components

#### ChunkLoader
```javascript
class ChunkLoader {
  async loadChunk(worldId, x, y, z): ChunkData
  getCachedChunk(x, y, z): ChunkData | null
  unloadChunk(x, y, z): void
}
```

#### ChunkManager
```javascript
class ChunkManager {
  update(cameraPos) {
    // 1. Determine visible chunks (frustum culling)
    // 2. Load missing chunks (priority by distance)
    // 3. Unload distant chunks (>100m)
    // 4. Prefetch based on camera velocity
  }
}
```

#### Modified SVDAG Renderer
**Current:** Single 256³ SVDAG with one root  
**New:** Multi-chunk SVDAG traversal

**Changes needed:**
1. **Shader:** Add chunk switching logic
```wgsl
fn raymarch(ray) {
  while (t < MAX_DIST) {
    let chunkPos = worldToChunk(ray.pos);
    let chunkIdx = getChunkIndex(chunkPos);
    if (chunkIdx == NO_CHUNK) { t += CHUNK_SIZE; continue; }
    
    let hit = traverseChunk(ray, chunkIdx);
    if (hit.hit) return hit;
    t = hit.exitT;
  }
}
```

2. **Buffers:** Concatenate all loaded chunks
```javascript
// Concatenate chunk nodes/leaves into single GPU buffer
globalNodes = concat(chunks.map(c => c.nodesBuffer));
globalLeaves = concat(chunks.map(c => c.leavesBuffer));

// Track offsets for each chunk
chunkMetadata[i] = {
  worldPos: [x, y, z],
  nodesOffset: currentOffset,
  rootIdx: chunk.rootIdx + currentOffset
};
```

3. **New Buffer:** Chunk metadata array
```wgsl
struct ChunkMeta {
  worldPos: vec3<i32>,
  nodesOffset: u32,
  leavesOffset: u32,
  rootIdx: u32,
}
@binding(X) var<storage> chunkMeta: array<ChunkMeta>;
```

---

## 5. Implementation Plan

### Phase 1: Server Graph Execution (3-5 days)
1. Port `pipeline.js` and all 28 nodes to server
2. Implement CPU-based node execution (no WebGPU initially)
3. Create `/api/worlds/:worldId/generate` endpoint
4. Test full-map generation

**Deliverable:** Server can generate 512×512 heightmaps

### Phase 2: Chunk Generation (5-7 days)
1. Implement 32³ chunk extraction from full maps
2. Port `SVDAGBuilder` to server
3. Create binary SVDAG encoder
4. Implement `/api/worlds/:worldId/chunks/:x/:y/:z`
5. Add file-based caching

**Deliverable:** Server returns binary SVDAG chunks

### Phase 3: Client Chunk Loading (7-10 days)
1. Create `ChunkLoader` + `ChunkManager` classes
2. Modify `SvdagRenderer` to concatenate chunks
3. Update shader for multi-chunk traversal
4. Test with 1 chunk, then multiple

**Deliverable:** Client renders chunked world

### Phase 4: Optimization (7-10 days)
1. Add chunk prefetching
2. Implement gzip compression
3. Add Redis hot cache
4. Worker pool for concurrent generation
5. Performance profiling

**Deliverable:** Production-ready system

**Total Estimate:** 22-32 days

---

## 6. Key Challenges

### Challenge 1: Node Graph Execution on Server
**Problem:** All 28 nodes use WebGPU compute shaders (client-only)  
**Solutions:**
- **Option A:** Pure CPU implementations (slower, portable)
- **Option B:** Use `@webgpu/dawn` Node.js bindings (fast, complex setup)
- **Option C:** Hybrid - CPU for simple nodes, GPU for heavy ones
**Recommendation:** Start with A, migrate to B in Phase 4

### Challenge 2: Chunk Boundary Continuity
**Problem:** Terrain features (biomes, erosion) may not align at chunk edges  
**Solutions:**
- Execute graph for slightly larger region (34×34) then crop to 32×32
- Store overlap data in chunk metadata
- Use consistent seed-based generation (deterministic per coordinate)
**Recommendation:** 2-voxel overlap on each edge

### Challenge 3: Memory Management
**Problem:** 2,048 chunks × 50KB = 100MB+ if all loaded  
**Solutions:**
- Only load visible chunks (typically 50-100)
- LRU eviction for chunks >100m from camera
- Stream chunks from disk/network as needed
**Target:** 50-100MB client memory (vs 500MB current)

### Challenge 4: Network Latency
**Problem:** Each chunk request = round trip (10-100ms)  
**Solutions:**
- Prefetch chunks based on camera direction
- Batch chunk requests (HTTP/2 multiplexing)
- Compress chunks (gzip: 3-5× reduction)
- Cache aggressively (95%+ hit rate)
**Target:** <100ms chunk load time including network

---

## 7. Performance Targets

### Server
- **Cold chunk:** <500ms (generate + cache)
- **Warm chunk:** <10ms (cached)
- **Throughput:** 10-50 chunks/second

### Client
- **Chunk load:** <100ms (network + parse + GPU upload)
- **Active chunks:** 50-100 in memory
- **Memory:** 50-100MB (vs 500MB current)
- **FPS:** 60+ (no regression)

### Network
- **Initial load:** 0.5-2.5 MB (50 chunks)
- **Streaming:** 50-500 KB/s (5-10 chunks/sec while moving)
- **Session total:** 10-50 MB (5 min gameplay)

---

## 8. Migration Strategy

### Backward Compatibility
Keep existing system working during migration:
1. Current client still loads full PNG heightmaps
2. New `/chunks/` endpoint runs in parallel
3. Add `?useChunks=true` query param to opt-in
4. Gradual rollout once stable

### Testing Plan
1. **Unit tests:** Each node type (server vs client parity)
2. **Integration tests:** Full graph execution (server matches client)
3. **Chunk tests:** SVDAG correctness (compare to monolithic)
4. **Load tests:** 100+ concurrent chunk requests
5. **Visual tests:** Render side-by-side (chunked vs monolithic)

---

## 9. Future Extensions

### Phase 5+ (Optional)
- **Infinite worlds:** Generate chunks on-the-fly (no 512×512 limit)
- **LOD system:** Coarser chunks at distance (16³, 8³)
- **Client-side generation:** Instant preview while waiting for server
- **Persistent editing:** Save modified voxels per chunk
- **Multiplayer sync:** Share chunks between clients
- **Chunk versioning:** Update chunks when graph changes

---

## 10. Risks & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| CPU performance too slow | High | High | Pre-generate common chunks, add GPU acceleration later |
| Chunk boundary artifacts | Medium | Medium | Use 2-voxel overlap, test thoroughly |
| Network latency | Low | Medium | Aggressive prefetching, compression |
| WebGPU in Node.js unstable | Medium | Low | Use CPU fallback, defer GPU to Phase 4 |
| Client memory leaks | Medium | High | Careful chunk unloading, monitoring |

---

## Conclusion

This upgrade transforms the system from monolithic client-side generation to a scalable chunk-based streaming architecture. The server-side approach enables:
- ✅ **Faster loading:** 95%+ cache hit rate
- ✅ **Lower memory:** 5-10× reduction
- ✅ **Infinite worlds:** No size limits
- ✅ **Multiplayer:** Shared world state
- ✅ **Scalability:** Generate only what's visible

**Estimated Total Effort:** 22-32 days (4-6 weeks)

**Recommended Start:** Phase 1 (Server Graph Execution)
