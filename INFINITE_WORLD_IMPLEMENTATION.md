# Infinite World Implementation - Updated Design

**Addresses feedback on server-side chunk generation with infinite worlds, GPU acceleration, and dual SVDAGs**

---

## 1. Key Changes from Original Design

### 1.1 Infinite World Support

**Original:** Fixed 512×256×512 world (16×8×16 chunks)  
**Updated:** Infinite world - any chunk coordinate `(x, y, z)` where `x, y, z ∈ [-2³¹, 2³¹]`

**Chunk Addressing:**
```
World Position (meters) → Chunk Coordinate:
  chunkX = floor(worldX / (chunkSize × voxelSize))
  chunkY = floor(worldY / (chunkSize × voxelSize))
  chunkZ = floor(worldZ / (chunkSize × voxelSize))

Example (32³ chunks, 0.33m voxels):
  World (0, 0, 0) → Chunk (0, 0, 0)
  World (100, 50, -75) → Chunk (9, 4, -8)
```

**Server validates requested coordinates** but doesn't enforce bounds - any `i32` coordinate is valid.

### 1.2 Dual SVDAG Per Chunk

**Each chunk contains TWO SVDAGs:**
1. **Material SVDAG** - All voxels (stone, grass, water, air gaps)
2. **Opaque SVDAG** - Only opaque voxels (water/glass = air for shadow casting)

**Binary Format Extended:**
```
Header (40 bytes, extended from 32):
  [0-31]  - Original fields
  [32]    - opaqueRootIdx: u32
  [36]    - opaqueNodeCount: u32

Material Nodes Section
Material Leaves Section
Opaque Nodes Section
Opaque Leaves Section
```

### 1.3 GPU Acceleration on Server (Now, Not Later)

**Use @webgpu/dawn for server-side WebGPU:**
```bash
npm install @webgpu/dawn
```

**Server can now run the SAME compute shaders** as client:
- Perlin noise generation
- Biome classification
- Block classification
- SVDAG building (potentially)

**Fallback:** CPU implementations if GPU unavailable (cloud servers)

### 1.4 Materials Included in Response

**Response headers include material definitions:**
```http
X-Materials: [{"id":1,"name":"Grass","color":[0.27,0.71,0.27],"transparent":0},...]
```

Or in JSON format response.

---

## 2. Server-Side Architecture (Updated)

### 2.1 Server with WebGPU

**File:** `services/graphExecutor.js`

```javascript
import { GPUAdapter } from '@webgpu/dawn';

export class GraphExecutor {
  constructor() {
    this.gpu = null;
    this.nodeRegistry = new Map();
  }
  
  async initialize() {
    // Initialize WebGPU on server
    try {
      const adapter = await navigator.gpu.requestAdapter();
      this.gpu = await adapter.requestDevice();
      console.log('Server WebGPU initialized');
    } catch (err) {
      console.warn('WebGPU unavailable, falling back to CPU:', err);
      this.gpu = null;
    }
  }
  
  async executeForChunk(graph, chunkX, chunkY, chunkZ, config) {
    const chunkSize = 32;
    const region = {
      x: chunkX * chunkSize,
      y: chunkY * chunkSize,
      z: chunkZ * chunkSize,
      width: chunkSize,
      height: chunkSize,
      depth: chunkSize
    };
    
    // Execute using GPU if available, CPU otherwise
    if (this.gpu) {
      return await this.executeGPU(graph, region, config);
    } else {
      return await this.executeCPU(graph, region, config);
    }
  }
  
  async executeGPU(graph, region, config) {
    // Run same shaders as client (PerlinNoise, BiomeClassifier, etc.)
    // Reuse client node implementations
  }
  
  async executeCPU(graph, region, config) {
    // CPU fallback implementations
  }
}
```

### 2.2 Chunk Generator with Dual SVDAGs

```javascript
export class ChunkGenerator {
  async generateChunk(worldId, chunkX, chunkY, chunkZ, graph, config) {
    // 1. Execute graph for chunk region
    const results = await this.executor.executeForChunk(
      graph, chunkX, chunkY, chunkZ, config
    );
    
    // 2. Build voxel grid (32³)
    const voxelGrid = this.buildVoxelGrid(results);
    
    // 3. Build Material SVDAG
    const materialSVDAG = this.buildSVDAG(voxelGrid, config.materials);
    
    // 4. Build Opaque SVDAG (water/glass → air)
    const opaqueGrid = this.makeOpaque(voxelGrid, config.materials);
    const opaqueSVDAG = this.buildSVDAG(opaqueGrid, config.materials);
    
    return {
      position: [chunkX, chunkY, chunkZ],
      materialSVDAG,
      opaqueSVDAG,
      materials: config.materials
    };
  }
  
  makeOpaque(voxelGrid, materials) {
    const opaque = new Uint32Array(voxelGrid.length);
    for (let i = 0; i < voxelGrid.length; i++) {
      const blockId = voxelGrid[i];
      const material = materials.find(m => m.id === blockId);
      // If transparent (water, glass), set to air
      opaque[i] = material?.transparent > 0.5 ? 0 : blockId;
    }
    return opaque;
  }
}
```

### 2.3 Extended Binary Format Encoder

```javascript
export class ChunkEncoder {
  encode(chunkData) {
    const { materialSVDAG, opaqueSVDAG } = chunkData;
    
    const headerSize = 40; // Extended
    const matNodesSize = materialSVDAG.nodesBuffer.byteLength;
    const matLeavesSize = materialSVDAG.leavesBuffer.byteLength;
    const opqNodesSize = opaqueSVDAG.nodesBuffer.byteLength;
    const opqLeavesSize = opaqueSVDAG.leavesBuffer.byteLength;
    
    const totalSize = headerSize + matNodesSize + matLeavesSize + 
                      opqNodesSize + opqLeavesSize;
    
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    
    // Header
    view.setUint32(0, 0x53564441, true);    // magic
    view.setUint32(4, 2, true);              // version 2 (dual SVDAG)
    view.setUint32(8, 32, true);             // chunkSize
    view.setUint32(12, materialSVDAG.nodeCount, true);
    view.setUint32(16, materialSVDAG.leafCount, true);
    view.setUint32(20, materialSVDAG.rootIdx, true);
    view.setUint32(24, 0x1, true);           // flags (bit 0 = hasOpaque)
    view.setUint32(28, 0, true);             // checksum
    view.setUint32(32, opaqueSVDAG.rootIdx, true);
    view.setUint32(36, opaqueSVDAG.nodeCount, true);
    
    // Write all sections...
    return Buffer.from(buffer);
  }
}
```

---

## 3. Client-Side Architecture (Shader Integration)

### 3.1 Multi-Chunk Shader Modifications

**Based on your `raymarcher_svdag.wgsl`, add chunk traversal:**

```wgsl
// Add chunk metadata buffer
struct ChunkMetadata {
  worldPos: vec3<i32>,       // Chunk grid position
  matNodesOffset: u32,       // Offset in global nodes buffer
  matLeavesOffset: u32,
  matRootIdx: u32,
  opqNodesOffset: u32,       // Opaque SVDAG offsets
  opqLeavesOffset: u32,
  opqRootIdx: u32,
  _pad: u32,
}

@group(0) @binding(10) var<storage, read> chunkMetadata: array<ChunkMetadata>;
@group(0) @binding(11) var<uniform> activeChunkCount: u32;

// Find which chunk contains a world position
fn getChunkIndex(worldPos: vec3<f32>) -> i32 {
  let chunkSize = 32.0 * svdag_params.leaf_size; // 32 voxels × size
  let chunkCoord = vec3<i32>(floor(worldPos / chunkSize));
  
  // Linear search through active chunks (optimize with spatial hash later)
  for (var i = 0u; i < activeChunkCount; i++) {
    let meta = chunkMetadata[i];
    if (all(meta.worldPos == chunkCoord)) {
      return i32(i);
    }
  }
  return -1; // Chunk not loaded
}

// Modified raymarch function
fn raymarch(ray: Ray) -> Hit {
  var t = 0.0;
  var lastChunkIdx = -1;
  
  while (t < MAX_DIST) {
    let pos = ray.origin + ray.dir * t;
    let chunkIdx = getChunkIndex(pos);
    
    if (chunkIdx < 0) {
      // Chunk not loaded - skip to next chunk boundary
      t += skipToNextChunk(pos, ray.dir);
      continue;
    }
    
    // Chunk changed - start new traversal
    if (chunkIdx != lastChunkIdx) {
      lastChunkIdx = chunkIdx;
      // Convert world pos to chunk-local coords
      let meta = chunkMetadata[chunkIdx];
      let chunkOrigin = vec3<f32>(meta.worldPos) * 32.0 * svdag_params.leaf_size;
      let localPos = pos - chunkOrigin;
      
      // Initialize stack for this chunk's SVDAG
      // ... (use meta.matRootIdx as root)
    }
    
    // Traverse current chunk's SVDAG
    let hit = traverseChunkSVDAG(localPos, ray.dir, chunkIdx);
    if (hit.hit) {
      return hit;
    }
    
    t = hit.exitT;
  }
  
  return miss();
}

fn skipToNextChunk(pos: vec3<f32>, dir: vec3<f32>) -> f32 {
  let chunkSize = 32.0 * svdag_params.leaf_size;
  let chunkCoord = floor(pos / chunkSize);
  let nextChunkOrigin = (chunkCoord + sign(dir)) * chunkSize;
  
  // Ray-AABB intersection to next chunk
  let tMin = (nextChunkOrigin - pos) / dir;
  return min(min(tMin.x, tMin.y), tMin.z) + 0.001;
}
```

### 3.2 ChunkManager Integration

```javascript
// public/js/chunkManager.js
export class ChunkManager {
  async update(cameraPos) {
    const chunkPos = this.worldToChunk(cameraPos);
    
    // Load chunks in radius
    const toLoad = this.getChunksInRadius(chunkPos, 5);
    for (const [x, y, z] of toLoad) {
      await this.loadChunk(x, y, z);
    }
    
    // Unload distant
    this.unloadDistant(chunkPos, 7);
    
    // Update GPU buffers
    this.updateGPUBuffers();
  }
  
  updateGPUBuffers() {
    // Concatenate all loaded chunks
    const chunks = Array.from(this.activeChunks.values());
    
    let matNodesOffset = 0;
    let matLeavesOffset = 0;
    let opqNodesOffset = 0;
    let opqLeavesOffset = 0;
    
    const metadata = [];
    const matNodesArrays = [];
    const matLeavesArrays = [];
    const opqNodesArrays = [];
    const opqLeavesArrays = [];
    
    for (const chunk of chunks) {
      metadata.push({
        worldPos: chunk.position,
        matNodesOffset,
        matLeavesOffset,
        matRootIdx: chunk.materialSVDAG.rootIdx + matNodesOffset,
        opqNodesOffset,
        opqLeavesOffset,
        opqRootIdx: chunk.opaqueSVDAG.rootIdx + opqNodesOffset,
      });
      
      matNodesArrays.push(chunk.materialSVDAG.nodesBuffer);
      matLeavesArrays.push(chunk.materialSVDAG.leavesBuffer);
      opqNodesArrays.push(chunk.opaqueSVDAG.nodesBuffer);
      opqLeavesArrays.push(chunk.opaqueSVDAG.leavesBuffer);
      
      matNodesOffset += chunk.materialSVDAG.nodesBuffer.length;
      matLeavesOffset += chunk.materialSVDAG.leavesBuffer.length;
      opqNodesOffset += chunk.opaqueSVDAG.nodesBuffer.length;
      opqLeavesOffset += chunk.opaqueSVDAG.leavesBuffer.length;
    }
    
    // Concatenate and upload
    const globalMatNodes = this.concat(matNodesArrays);
    const globalMatLeaves = this.concat(matLeavesArrays);
    const globalOpqNodes = this.concat(opqNodesArrays);
    const globalOpqLeaves = this.concat(opqLeavesArrays);
    
    this.device.queue.writeBuffer(this.matNodesBuffer, 0, globalMatNodes);
    this.device.queue.writeBuffer(this.matLeavesBuffer, 0, globalMatLeaves);
    this.device.queue.writeBuffer(this.opqNodesBuffer, 0, globalOpqNodes);
    this.device.queue.writeBuffer(this.opqLeavesBuffer, 0, globalOpqLeaves);
    this.device.queue.writeBuffer(this.metadataBuffer, 0, this.encodeMetadata(metadata));
  }
}
```

---

## 4. Performance Optimizations

### 4.1 Server-Side GPU Acceleration

**Benefits:**
- 10-50× faster than CPU for noise generation
- Reuse existing client shader code
- Consistent results (same shaders)

**Challenges:**
- `@webgpu/dawn` requires native bindings (may not work on all cloud hosts)
- Headless GPU access (requires Vulkan/Metal/D3D12)

**Recommendation:** Use GPU on local dev server, CPU on cloud (pre-generate common chunks)

### 4.2 Spatial Hash for Chunk Lookup

**Current:** Linear search (O(n) per ray)  
**Optimized:** Spatial hash (O(1) lookup)

```wgsl
// Compute shader to build spatial hash
fn chunkHash(coord: vec3<i32>) -> u32 {
  return u32(coord.x * 73856093 ^ coord.y * 19349663 ^ coord.z * 83492791) % HASH_SIZE;
}
```

Store in uniform buffer, shader does O(1) lookup.

### 4.3 WASM for CPU Fallback (Optional)

**When GPU unavailable, use WASM:**
- 2-10× faster than pure JS
- Compile Rust/C++ noise + SVDAG builder
- ~5ms per chunk vs 50ms in JS

**Not required now** - document for future reference.

---

## 5. Implementation Checklist

### Phase 1: Infinite World Foundation (Week 1)
- [ ] Remove chunk grid bounds from server
- [ ] Update API to accept any `i32` coordinates
- [ ] Test chunk generation at extreme coords (x=1000000, y=-5000)
- [ ] Update cache keys to handle negative coords

### Phase 2: Server WebGPU (Week 2)
- [ ] Install `@webgpu/dawn`
- [ ] Port client nodes to server (reuse shader code)
- [ ] Add CPU fallback for non-GPU environments
- [ ] Benchmark: GPU vs CPU generation time

### Phase 3: Dual SVDAG (Week 2-3)
- [ ] Extend binary format to v2 (40-byte header)
- [ ] Build opaque SVDAG on server
- [ ] Update encoder/decoder for dual format
- [ ] Test shadow casting with opaque DAG

### Phase 4: Client Multi-Chunk Shader (Week 3-4)
- [ ] Add `chunkMetadata` buffer to shader
- [ ] Implement `getChunkIndex()` and chunk switching
- [ ] Test with 2 chunks, then 10, then 100
- [ ] Add spatial hash optimization

### Phase 5: Integration & Polish (Week 4-5)
- [ ] End-to-end test: infinite world navigation
- [ ] Performance: maintain 60 FPS with 100 active chunks
- [ ] Memory: keep under 100MB client-side
- [ ] Cache hit rate: achieve >95%

---

## 6. Testing Strategy

### 6.1 Infinite World Tests
```javascript
// Test extreme coordinates
await loadChunk(1000000, 500000, -750000);
// Should generate consistent terrain (seed-based)

// Test chunk boundaries
const pos1 = getVoxel(31, 16, 31); // End of chunk (0,0,0)
const pos2 = getVoxel(32, 16, 31); // Start of chunk (1,0,0)
// Should be seamless (no cracks)
```

### 6.2 Dual SVDAG Tests
```javascript
// Verify opaque DAG excludes water
const chunk = await generateChunk(0, 0, 0);
const waterVoxels = countBlockType(chunk.materialSVDAG, 6); // Water ID
const opaqueWater = countBlockType(chunk.opaqueSVDAG, 6);
assert(waterVoxels > 0 && opaqueWater === 0);
```

---

## 7. Future Enhancements

### 7.1 WASM Integration (Optional)
- Compile noise + SVDAG to WASM
- 2-10× faster CPU fallback
- See IMPLEMENTATION_EXAMPLES.md for details

### 7.2 Chunk LOD System
- Generate 16³ chunks at distance
- Generate 32³ chunks nearby
- Generate 64³ chunks for caves/detail

### 7.3 Persistent World Editing
- Track modified voxels per chunk
- Store deltas in database
- Merge deltas with procedural generation

---

## Conclusion

This updated design supports:
✅ **Infinite worlds** - any chunk coordinate  
✅ **Dual SVDAGs** - material + opaque for shadows  
✅ **Server GPU** - WebGPU via @webgpu/dawn  
✅ **Client shader** - multi-chunk traversal  
✅ **WASM ready** - CPU fallback path defined  

**Next:** Implement Phase 1 (infinite world) and test with extreme coordinates.
