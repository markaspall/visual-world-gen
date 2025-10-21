# Visual World Generation - Design Overview

**Version**: 1.0  
**Date**: October 20, 2025  
**Status**: Pre-Implementation

---

## Executive Summary

GPU-accelerated procedural voxel world generation using a multi-resolution pipeline. Start with 128×128 base maps for expensive operations (erosion), upscale to 512×512 for detail, generate 32³ voxel chunks on-demand. Server-side GPU computes everything, client just renders received SVDAG chunks.

**Key Innovation**: Two-pass moisture system - use historical moisture for erosion, then apply different current moisture. Creates dry eroded canyons and wet uneroded plateaus.

---

## Core Architecture

### System Components

```
┌─────────────────────────────────────────────────────┐
│                CLIENT (Browser)                      │
│  - Requests chunks: GET /chunks/:x/:y/:z           │
│  - Receives SVDAG binary                            │
│  - Renders voxels                                   │
└─────────────────────────────────────────────────────┘
                        ↕ HTTPS
┌─────────────────────────────────────────────────────┐
│          SERVER (Node.js + WebGPU)                  │
│                                                      │
│  ┌───────────────────────────────────────────────┐ │
│  │  GPU Pipeline (WebGPU Compute Shaders)        │ │
│  │                                                │ │
│  │  LOD 0 (128×128) → Erosion → LOD 1 (512×512) │ │
│  │              ↓                                 │ │
│  │         Chunk Gen (32³) → SVDAG                │ │
│  └───────────────────────────────────────────────┘ │
│                                                      │
│  Cache: Region textures (GPU) + Chunks (disk)      │
└─────────────────────────────────────────────────────┘
```

### Data Flow

```
Seed → LOD 0 Base (128×128, GPU)
    → Pre-Erosion Moisture (128×128, GPU)
    → Erosion Sim (128×128, GPU, moisture-aware)
    → Post-Erosion Moisture (128×128, GPU, different sample)
    → Upscale to LOD 1 (512×512, GPU bicubic)
    → Rivers/Biomes (512×512, GPU)
    → Chunk Voxels (32³, GPU)
    → SVDAG Compress (CPU)
    → Cache & Send
```

---

## Multi-Resolution Design

### Why Multi-Resolution?

**Problem**: 512×512 erosion = 262K points × 100 steps × 10 iterations = too slow

**Solution**: Erode at 128×128 (16K points, 16× faster), upscale to 512×512

**Trade-off**: Lose some high-frequency detail, but erosion creates low-frequency features anyway (valleys, drainage). Acceptable quality loss for massive speed gain.

### Resolution Levels

| LOD | Size | Coverage | Purpose | Cost |
|-----|------|----------|---------|------|
| 0 | 128×128 | 512×512 world | Base terrain, erosion | 5ms + 50ms erosion |
| 1 | 512×512 | 512×512 world | High-res features | 10ms upscale + 15ms features |
| Chunk | 32³ | 32³ world | Final voxels | 3ms per chunk |

### LOD 0: Base Generation (128×128)

**Generated Maps**:
1. **Base Elevation** - Multi-octave Perlin noise
   - Continental (0.0005 freq): 60% weight
   - Regional (0.002 freq): 30% weight
   - Local (0.01 freq): 10% weight
   - Output: 0.0-1.0 normalized height

2. **Pre-Erosion Moisture** - Different Perlin noise
   - Frequency: 0.001
   - Used ONLY for erosion simulation
   - Not used for final biomes

3. **Temperature** - Latitude + elevation + noise
   - Base: 1.0 - (latitude × 0.5)
   - Elevation cooling: -elevation × 0.3
   - Noise variation: ±0.2

**GPU Shader**: Parallel noise evaluation, ~5ms total

### Erosion Pass (128×128)

**Method**: GPU particle-based hydraulic erosion

**Key Features**:
- **Moisture-aware**: Erosion rate scaled by pre-erosion moisture
  - Wet areas (moisture > 0.7): Full erosion
  - Moderate (0.3-0.7): Partial erosion
  - Dry areas (< 0.3): Minimal erosion
- **Atomic operations**: Thread-safe height modifications
  - Store heights as fixed-point integers (× 1,000,000)
  - Use `atomic<i32>` for collision-free updates
- **Deterministic**: Same seed + iteration → same result

**Parameters**:
```
numParticles: 50,000 per iteration
iterations: 10
erosionRate: 0.001 (base, scaled by moisture)
depositionRate: 0.3
evaporationRate: 0.95
maxSteps: 100 per particle
```

**Performance**: 50,000 particles × 10 iterations × 5ms = ~50ms

**GPU Shader Structure**:
```wgsl
@group(0) @binding(0) var<storage, read_write> heightmap: array<atomic<i32>>;
@group(0) @binding(1) var<storage, read> moisture: array<f32>;

@compute @workgroup_size(256)
fn erode_pass(@builtin(global_invocation_id) id: vec3<u32>) {
  let particleId = id.x;
  
  // Deterministic start position
  var pos = randomPosition(seed, particleId, iteration);
  
  for (step in 0..100) {
    let localMoisture = moisture[idx];
    let erosion = erosionRate * speed * localMoisture; // Key!
    
    // Thread-safe height modification
    atomicSub(&heightmap[idx], toFixed(erosion));
    
    // Move downhill, deposit sediment...
  }
}
```

### Post-Erosion Moisture (128×128)

**Purpose**: Current climate independent of erosion history

**Method**: Sample Perlin noise with DIFFERENT frequency and seed offset

**Why This Matters**:
- Erosion shaped by historical moisture (wetter in past)
- Current moisture is different (climate changed)
- **Result**: Dry canyons (eroded when wet), wet plateaus (dry when erosion happened)
- Creates varied, interesting biomes

**Parameters**:
```
frequency: 0.0012 (different from 0.001 pre-erosion)
seedOffset: +5000 (ensures different pattern)
```

**GPU Shader**: Simple parallel noise sampling, ~2ms

### LOD 1: Upscaling (128→512)

**Method**: GPU bicubic interpolation (4× scale factor)

**Upscaled Maps**:
1. Eroded heightmap (128→512)
2. Post-erosion moisture (128→512)
3. Temperature (128→512)

**GPU Implementation**: Texture sampling with linear interpolation
- Create 128×128 GPU texture from buffer
- Sample at 512×512 resolution with bilinear filter
- Hardware-accelerated, very fast

**Performance**: ~10ms for all three maps

### LOD 1: Feature Generation (512×512)

**Generated Features**:

1. **Rivers** - Flow accumulation
   - Each pixel finds lowest neighbor
   - Atomically increment neighbor's flow counter
   - River pixels: flowAccumulation > threshold (e.g., 100)
   - Output: Uint32 flow values

2. **Biomes** - Classification
   - Input: height, moisture, temperature
   - Simple decision tree classification
   - Biome IDs: 0=ocean, 1=beach, 2=grassland, etc.
   - Output: Uint8 biome IDs

3. **Cave Density** - Hints for 3D caves
   - Sample 3D noise at several Y levels
   - Count how many exceed threshold
   - Guides chunk generation (faster than full 3D sampling)
   - Output: Uint8 density (0-7)

4. **Features** - Points of interest
   - Detect local maxima (peaks)
   - Find cave openings (steep slopes + high cave density)
   - Mark river sources
   - Stored as sparse array

**Performance**: ~15ms total for all features

---

## Chunk Generation

### Process

**Input** (per chunk request):
- Chunk coordinates (cx, cy, cz)
- World seed
- LOD 1 textures (heightmap, biomes, rivers, etc.)

**Output**:
- 32³ Uint32Array of block IDs
- Compressed to SVDAG
- Cached and sent to client

### GPU Compute Shader (32³ threads)

```wgsl
@compute @workgroup_size(4, 4, 4)  // 64 threads per group
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  // World position
  let worldX = chunkX * 32 + id.x;
  let worldY = chunkY * 32 + id.y;
  let worldZ = chunkZ * 32 + id.z;
  
  // Sample LOD 1 textures (hardware-accelerated)
  let u = (worldX - regionX) / 512.0;
  let v = (worldZ - regionZ) / 512.0;
  
  let surfaceHeight = textureSample(heightmapTex, sampler, uv).r * 256.0;
  let biome = textureSample(biomeTex, sampler, uv).r;
  let riverFlow = textureSample(riverTex, sampler, uv).r;
  
  // Determine block type
  var blockType: u32;
  
  let depth = surfaceHeight - worldY;
  
  if (depth < 0.0) {
    // Above surface
    if (worldY < SEA_LEVEL) {
      blockType = WATER;
    } else if (riverFlow > 10 && worldY < surfaceHeight + 3.0) {
      blockType = WATER;
    } else {
      blockType = AIR;
    }
  } else {
    // Check cave (3D noise)
    if (simplex3D(worldX * 0.02, worldY * 0.02, worldZ * 0.02, seed) > 0.6) {
      blockType = AIR;
    } else {
      // Solid terrain layers
      if (depth < 1.0) {
        blockType = getSurfaceBlock(biome);
      } else if (depth < 4.0) {
        blockType = DIRT;
      } else {
        blockType = STONE;
      }
    }
  }
  
  // Write to output buffer
  voxels[id.z * 1024 + id.y * 32 + id.x] = blockType;
}
```

**Performance**: 32³ = 32,768 threads in parallel, ~3ms

### Block Type Mapping

```typescript
enum BlockType {
  AIR = 0,     // Transparent, no collision
  STONE = 1,   // Gray, opaque, solid
  DIRT = 2,    // Brown, opaque, solid
  GRASS = 3,   // Green, opaque, solid
  SAND = 4,    // Tan, opaque, solid
  SNOW = 5,    // White, opaque, solid
  WATER = 6,   // Blue, transparent (α=0.2), no collision
  LAVA = 7     // Red/orange, transparent, emissive
}

// Surface block by biome
BIOME_SURFACE_BLOCKS = {
  OCEAN: SAND,
  BEACH: SAND,
  GRASSLAND: GRASS,
  FOREST: GRASS,
  DESERT: SAND,
  TUNDRA: SNOW,
  MOUNTAIN: STONE
}
```

### SVDAG Compression (CPU)

**After GPU generates voxel grid**:

1. **Build Octree** - Recursive subdivision
   - Start with 32³ root
   - Subdivide if not uniform
   - Create tree of nodes

2. **Deduplicate** - Hash-based node merging
   - Identical subtrees share same node
   - Massive compression for uniform regions

3. **Linearize** - Flatten tree to arrays
   - `nodesBuffer`: Uint32Array of child pointers
   - `leavesBuffer`: Uint32Array of leaf voxel data

4. **Encode** - Binary format
   - Header: root index, counts
   - Node buffer
   - Leaf buffer

**Performance**: ~2ms for octree + deduplication

**Compression Ratio**:
- Uncompressed: 32³ × 4 bytes = 128 KB
- SVDAG: typically 16-64 KB (2-8× compression)
- Air chunks: ~1 KB (128× compression!)
- Solid chunks: ~4 KB (32× compression)

---

## Caching Strategy

### Two-Level Cache

**Level 1: GPU Region Cache (VRAM)**
- LOD 1 textures (512×512)
- Kept in GPU memory
- ~4.5 MB per region
- 20 active regions = ~90 MB VRAM

**Level 2: SVDAG Chunk Cache (Disk)**
- Compressed chunks
- Written to filesystem
- ~32 KB average per chunk
- 1000 chunks = ~32 MB disk

### Cache Hierarchy

```javascript
async getChunk(cx, cy, cz, seed) {
  // 1. Check SVDAG cache (~3ms if hit)
  const cached = await diskCache.get(`${cx}_${cy}_${cz}`);
  if (cached) return cached;
  
  // 2. Determine region
  const regionX = floor(cx * 32 / 512) * 512;
  const regionZ = floor(cz * 32 / 512) * 512;
  
  // 3. Get/generate region textures (~70ms if miss, 0ms if hit)
  const region = await getRegion(regionX, regionZ, seed);
  
  // 4. Generate chunk on GPU (~3ms)
  const voxels = await generateChunkGPU(cx, cy, cz, region);
  
  // 5. Compress to SVDAG (~2ms)
  const svdag = buildSVDAG(voxels);
  
  // 6. Cache and return (~1ms)
  await diskCache.set(`${cx}_${cy}_${cz}`, svdag);
  return svdag;
}
```

**Latency**:
- Cached chunk: ~3ms
- Uncached chunk, cached region: ~6ms
- Cold region: ~76ms (first chunk only)

---

## Performance Budget

### Region Generation (First Chunk)

| Stage | Resolution | Time | Notes |
|-------|-----------|------|-------|
| Base elevation | 128×128 | 2ms | Parallel noise |
| Pre-erosion moisture | 128×128 | 2ms | Parallel noise |
| Temperature | 128×128 | 1ms | Parallel compute |
| Erosion (10 iter) | 128×128 | 50ms | Particle sim |
| Post-erosion moisture | 128×128 | 2ms | Parallel noise |
| Upscale to 512 | → 512×512 | 10ms | Bicubic interpolation |
| Rivers | 512×512 | 5ms | Flow accumulation |
| Biomes | 512×512 | 3ms | Classification |
| Cave density | 512×512 | 5ms | Multi-level sampling |
| **Total** | | **80ms** | **Per region** |

### Subsequent Chunks (Region Cached)

| Stage | Resolution | Time | Notes |
|-------|-----------|------|-------|
| Region lookup | — | 0ms | Already in VRAM |
| Chunk generation | 32³ | 3ms | GPU compute |
| SVDAG compression | 32³ | 2ms | CPU octree |
| Encoding | — | 1ms | Binary format |
| **Total** | | **6ms** | **Per chunk** |

### Cached Chunks

| Stage | Time |
|-------|------|
| Disk read | 2ms |
| Network send | <1ms |
| **Total** | **~3ms** |

---

## Implementation Plan

### Phase 1: End-to-End Skeleton (Week 1)

**Goal**: Noise → SVDAG pipeline working

**Tasks**:
1. Set up WebGPU on Node.js server
2. Create base elevation compute shader (128×128)
3. Create simple upscale shader (128→512)
4. Create chunk generation shader (32³, no caves yet)
5. Integrate with existing SVDAG builder
6. Test: Request chunk, get back SVDAG

**Deliverable**: Working but feature-light chunks

### Phase 2: Add Erosion (Week 2)

**Goal**: Realistic terrain with valleys

**Tasks**:
1. Implement pre-erosion moisture shader
2. Implement hydraulic erosion shader with atomic ops
3. Implement post-erosion moisture shader
4. Test erosion parameters (iteration count, rates)
5. Visual validation of erosion results

**Deliverable**: Eroded terrain

### Phase 3: Add Features (Week 3)

**Goal**: Rivers, biomes, caves

**Tasks**:
1. Implement river flow accumulation
2. Implement biome classification
3. Implement 3D cave noise in chunk shader
4. Add water logic (rivers + ocean)
5. Test biome transitions

**Deliverable**: Feature-complete chunks

### Phase 4: Optimization & Caching (Week 4)

**Goal**: Production performance

**Tasks**:
1. Add GPU region texture cache
2. Add disk SVDAG cache
3. Profile and optimize hot paths
4. Add cache invalidation
5. Load testing (multiple concurrent chunk requests)

**Deliverable**: Production-ready system

### Phase 5: Polish (Ongoing)

**Tasks**:
- Parameter tuning (noise frequencies, erosion rates)
- Add more biomes
- Improve cave generation
- Add features (structures, trails)
- Visual debugging tools

---

## Technical Specifications

### GPU Requirements

**Minimum**:
- WebGPU support (Vulkan/Metal/DX12)
- 2 GB VRAM
- Compute shader support

**Recommended**:
- 4 GB+ VRAM
- Modern GPU (2020+)
- Fast memory bandwidth

### Memory Usage

**GPU (VRAM)**:
- Per region: ~5 MB (LOD 0 + LOD 1 textures)
- 20 active regions: ~100 MB
- Scratch buffers: ~50 MB
- **Total: ~150 MB VRAM**

**CPU (RAM)**:
- Node.js runtime: ~100 MB
- Chunk cache: ~100 MB (1000 chunks)
- Misc: ~50 MB
- **Total: ~250 MB RAM**

### Network

**Per chunk**:
- SVDAG size: 16-64 KB typical
- At 1 Mbps: ~0.1-0.5s transfer
- At 10 Mbps: ~0.01-0.05s transfer

**Chunk request rate**:
- Player moving: ~5-10 chunks/sec
- Throughput: 160-640 KB/sec = 1.3-5.1 Mbps

### Disk

**Cache size**:
- 1000 chunks: ~32 MB
- 10,000 chunks: ~320 MB
- 100,000 chunks: ~3.2 GB

**I/O**:
- SSD read: ~2ms per chunk
- HDD read: ~10ms per chunk
- Use SSD for best performance

---

## Key Design Decisions

### 1. Why Multi-Resolution?

**Decision**: Generate 128×128 base, erode there, upscale to 512×512

**Rationale**:
- Erosion is O(n²) in particle count
- 128² = 16K vs 512² = 262K (16× fewer points)
- Erosion creates low-frequency features (valleys) - upscaling works well
- 16× speed improvement worth small quality loss

**Trade-off**: Some fine erosion detail lost, but acceptable

### 2. Why Two Moisture Maps?

**Decision**: Use different moisture for erosion vs final biomes

**Rationale**:
- Real climate changes over geological time
- Creates interesting scenarios:
  - Dry canyon: Eroded when wet, now dry
  - Wet plateau: Stayed high because it was dry during erosion
- More varied biomes
- More realistic looking terrain

**Implementation**: Just use different seed offset for second Perlin sample

### 3. Why GPU Erosion with Atomics?

**Decision**: Use atomic operations for particle-based erosion on GPU

**Rationale**:
- Particles can collide (modify same heightmap pixel)
- Atomic ops ensure thread safety
- Fixed-point arithmetic (int32) for atomic support
- Alternative (lock-free) would be wrong or slower

**Trade-off**: Fixed-point precision (6 decimal places), but sufficient

### 4. Why Server-Side Generation?

**Decision**: Generate chunks on server, send SVDAG to client

**Rationale**:
- Consistent world for all players
- Server has GPU access (can be powerful)
- Client just renders (simpler, works on low-end)
- Cache chunks once, serve many clients

**Trade-off**: Network latency, but compressed chunks are small

### 5. Why SVDAG over Raw Voxels?

**Decision**: Compress chunks to SVDAG before caching/sending

**Rationale**:
- 32³ raw = 128 KB per chunk
- SVDAG = 16-64 KB typical (2-8× compression)
- Air chunks = ~1 KB (128× compression!)
- Less network, less disk, same quality

**Trade-off**: CPU time for compression (~2ms), but worth it

---

## Risk Mitigation

### Risk 1: Erosion Too Slow

**Mitigation**:
- Start with fewer iterations (5 instead of 10)
- Reduce particle count (25K instead of 50K)
- Profile and optimize shader
- If still slow, reduce LOD 0 resolution (64×64)

### Risk 2: Upscaling Artifacts

**Mitigation**:
- Use bicubic instead of bilinear interpolation
- Add post-upscale smoothing pass if needed
- Test with various terrain types
- Adjust LOD 0 noise frequencies if needed

### Risk 3: WebGPU Compatibility

**Mitigation**:
- Test on multiple GPUs (NVIDIA, AMD, Intel)
- Have CPU fallback for non-GPU servers
- Use WebGPU polyfills if needed
- Document minimum GPU requirements

### Risk 4: Cache Invalidation Complexity

**Mitigation**:
- Simple key-based invalidation (regionKey, chunkKey)
- LRU eviction for memory management
- Clear commands for testing
- Version stamp in cache keys

### Risk 5: Determinism Issues

**Mitigation**:
- Use integer-based noise (no float precision issues)
- Fixed random number generator with explicit seeds
- Test chunk regeneration consistency
- Document any known non-determinism

---

## Success Criteria

### Functional
- ✅ Chunks tile seamlessly (no gaps or overlaps)
- ✅ Same seed → same world (deterministic)
- ✅ Realistic terrain (valleys, rivers, mountains)
- ✅ Varied biomes
- ✅ 3D caves

### Performance
- ✅ First chunk in region: <100ms
- ✅ Subsequent chunks: <10ms
- ✅ Cached chunks: <5ms
- ✅ 20 active regions fit in VRAM

### Quality
- ✅ Erosion creates realistic valleys
- ✅ Rivers flow downhill
- ✅ Biome transitions smooth
- ✅ Caves are explorable
- ✅ No visual artifacts

---

## Next Steps

**Immediate**:
1. Read existing codebase (current chunk generation)
2. Set up WebGPU environment
3. Create first compute shader (base elevation)
4. Test noise generation visually

**This Week**:
- Complete Phase 1 (end-to-end pipeline)
- Generate first test chunk

**This Month**:
- Complete Phases 2-4
- Production-ready system

---

**Document Status**: Ready for implementation  
**Next Action**: Begin Phase 1, Task 1 (Set up WebGPU)
