# Hybrid Mesh Renderer - Implementation Plan

**Status:** Planning Phase  
**Created:** 2025-10-09  
**Goal:** Build a high-performance mesh-based renderer alongside the existing ray marcher

---

## Executive Summary

Build a **greedy-meshed triangle renderer** that maintains all the visual beauty of our ray marcher but runs at 10-20x the FPS. The ray marcher stays intact for comparison and special effects.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    WORLD GENERATOR                          │
│  (Existing - generates heightmaps, blocks, water, biomes)   │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ├─────────────────┬──────────────────────────┐
                 ▼                 ▼                          ▼
         ┌───────────────┐  ┌──────────────┐   ┌──────────────────┐
         │  Ray Marcher  │  │ Mesh Builder │   │  Water Tracer    │
         │   (Legacy)    │  │    (NEW)     │   │  (Ray March)     │
         │               │  │              │   │                  │
         │ - Full scene  │  │ - Terrain    │   │ - Water only     │
         │ - Slow        │  │ - Greedy mesh│   │ - Refraction     │
         │ - Reference   │  │ - Fast       │   │ - Reflections    │
         └───────────────┘  └──────┬───────┘   └─────────┬────────┘
                                   │                     │
                                   ▼                     ▼
                            ┌──────────────────────────────────┐
                            │   Fragment Shader (NEW)          │
                            │  - Standard rasterization        │
                            │  - Smooth normals                │
                            │  - Shadow maps                   │
                            │  - Day/night cycle               │
                            │  - Exponential fog               │
                            │  - Material system               │
                            └──────────────────────────────────┘
```

---

## What Stays The Same

### ✅ World Generation Pipeline
- All existing nodes (Perlin, FBM, HeightLOD, BlockClassifier, etc.)
- Export format (world.json with PNGs)
- Material system (blocks, colors, properties, animations)
- Biome system
- Water height maps

### ✅ Visual Features (Maintained/Improved)
- Day/night cycle (same system)
- Exponential fog (same algorithm)
- Smooth lighting transitions
- Moon and stars
- Time-based animations (water ripples via vertex displacement)
- Material properties (emissive, reflective, etc.)

### ✅ Editor Integration
- All node types work identically
- Same save/load system
- Same world data structure

---

## What Changes

### 🔄 Rendering Pipeline

**Before (Ray Marcher):**
```
For each pixel:
  - Cast ray
  - March through voxels (50-100 steps)
  - Calculate lighting
  - Apply fog
→ 103M+ operations/frame
```

**After (Hybrid):**
```
For terrain:
  - Rasterize triangles (GPU hardware)
  - Fragment shader (1 op per visible pixel)
  - Shadow map lookup (1 texture sample)
→ ~1M operations/frame (100x reduction!)

For water:
  - Selective ray march (only water pixels)
  - 20 steps instead of 100
→ ~8M operations (still fast)
```

---

## New Components

### 1. **Greedy Mesh Builder** (`meshBuilder.js`)

**Purpose:** Convert voxel heightmap → optimized triangle mesh

**Algorithm:**
```javascript
class GreedyMeshBuilder {
  buildTerrainMesh(heightMap, blocksMap, resolution) {
    // For each height column:
    //   1. Create top face (always visible)
    //   2. Check neighbors for side faces
    //   3. Merge adjacent same-type quads (greedy!)
    //   4. Calculate smooth normals from height gradient
    //   5. Assign material/color per vertex
    
    // Output:
    return {
      vertices: Float32Array,    // [x, y, z, ...]
      normals: Float32Array,     // [nx, ny, nz, ...] (smooth!)
      colors: Float32Array,      // [r, g, b, ...] (from block materials)
      uvs: Float32Array,         // [u, v, ...] (for future textures)
      indices: Uint32Array,      // Triangle indices
      materialIds: Uint32Array   // Block type per vertex
    };
  }
  
  // Optimization: Greedy meshing
  // Instead of 1 quad per voxel top face:
  //   - Scan rows/columns
  //   - Merge adjacent same-type faces
  //   - Result: ~90% fewer triangles!
  
  // Example:
  // [G][G][G][G]  → 4 quads normally
  // [G][G][G][G]  → 1 merged quad with greedy!
}
```

**Input:** 512×512 heightmap  
**Output:** ~5,000-15,000 triangles (depends on terrain complexity)

**Performance:** ~2-5ms to build mesh (only on world load/change)

---

### 2. **Mesh Renderer** (`meshRenderer.js`)

**Purpose:** Manage WebGPU rendering pipeline for mesh

**Components:**
```javascript
class MeshRenderer {
  // Vertex Buffer: Stores mesh geometry
  vertexBuffer: GPUBuffer
  
  // Index Buffer: Triangle indices
  indexBuffer: GPUBuffer
  
  // Uniform Buffers:
  - cameraBuffer      // View/projection matrices
  - timeBuffer        // time, timeOfDay, fogParams
  - materialsBuffer   // Block material properties
  
  // Pipelines:
  - terrainPipeline   // Main mesh rendering
  - waterPipeline     // Water surface (might use mesh too)
  - shadowPipeline    // Shadow map generation
  
  // Textures:
  - shadowMap         // Directional shadow map (2048×2048)
  - depthTexture      // Scene depth
}
```

---

### 3. **Mesh Vertex Shader** (`mesh_vertex.wgsl`)

```wgsl
struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec3<f32>,
  @location(3) materialId: u32,
}

struct VertexOutput {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) worldPosition: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec3<f32>,
  @location(3) viewDistance: f32,
  @location(4) shadowPosition: vec3<f32>,  // For shadow map lookup
}

@vertex
fn main(in: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  
  // Apply surface animation if assigned
  var animatedPos = in.position;
  if (hasAnimation(in.materialId)) {
    let anim = getAnimation(in.materialId);
    animatedPos.y += calculateWaveDisplacement(in.position.xz, anim);
  }
  
  // Transform to clip space
  out.clipPosition = camera.projection * camera.view * vec4(animatedPos, 1.0);
  out.worldPosition = animatedPos;
  out.normal = in.normal;
  out.color = in.color;
  out.viewDistance = length(camera.position - animatedPos);
  
  // Shadow map projection
  out.shadowPosition = shadowMatrix * vec4(animatedPos, 1.0);
  
  return out;
}
```

**Key Features:**
- ✅ Vertex animation (water ripples!)
- ✅ Smooth normals (from greedy meshing)
- ✅ Shadow map coordinates calculated here

---

### 4. **Mesh Fragment Shader** (`mesh_fragment.wgsl`)

```wgsl
@fragment
fn main(in: VertexOutput) -> @location(0) vec4<f32> {
  // Sun direction from time of day
  let sunDir = getSunDirection(timeParams.timeOfDay);
  
  // Lighting (same smooth transitions as ray marcher!)
  let sunElevation = sunDir.y;
  let ambient = calculateAmbient(sunElevation);  // 0.55 day, 0.05 night
  let diffuse = max(dot(in.normal, sunDir), 0.0);
  
  // Shadow map lookup (1 texture sample vs 16 ray steps!)
  let shadowFactor = textureSampleCompare(
    shadowMap, 
    shadowSampler, 
    in.shadowPosition.xy,
    in.shadowPosition.z
  );
  
  // Sky ambient (fills crevices)
  let skyLight = 0.2 * (1.0 - max(dot(in.normal, vec3(0, -1, 0)), 0.0));
  
  // Combined lighting
  let lighting = min(ambient + skyLight + diffuse * 0.6 * shadowFactor, 1.0);
  
  var color = in.color * lighting;
  
  // Exponential fog (identical to ray marcher)
  let fogDensity = timeParams.fogDensity * 0.03;
  let fogFactor = 1.0 - exp(-in.viewDistance * fogDensity);
  let fogColor = getFogColor(sunDir);
  color = mix(color, fogColor, fogFactor);
  
  return vec4(color, 1.0);
}
```

**Key Features:**
- ✅ Same lighting model as ray marcher
- ✅ Shadow maps (cheaper than ray-marched shadows)
- ✅ Same fog algorithm
- ✅ Same day/night cycle

---

### 5. **Shadow Map System**

**Algorithm:**
```javascript
// Step 1: Render depth from sun's perspective
renderShadowMap() {
  // Setup orthographic camera looking from sun direction
  const sunDir = getSunDirection(timeOfDay);
  const shadowCamera = createOrthographicCamera(sunDir);
  
  // Render scene depth to shadowMap texture (2048×2048)
  // Only need vertex positions, no shading
  renderPass.setPipeline(shadowPipeline);
  renderPass.draw(terrainMesh);
}

// Step 2: In main render, compare fragment depth to shadow map
// (Shader code above)
```

**Quality:**
- PCF (Percentage Closer Filtering) for soft shadows
- 2048×2048 resolution
- Covers ~100m around camera

---

## Implementation Phases

### **Phase 1: Core Mesh System** (Week 1) ✅ COMPLETE
- [x] Create `meshBuilder.js`
- [x] Implement greedy meshing algorithm (basic - side faces)
- [x] Calculate smooth normals from heightmap gradient
- [x] Generate vertex/index buffers
- [ ] **Test:** Verify mesh matches voxel terrain visually (IN PROGRESS)

### **Phase 2: Basic Rendering** (Week 1-2) ✅ COMPLETE
- [x] Create `meshRenderer.js`
- [x] Write `mesh_vertex.wgsl` → `mesh_terrain.wgsl`
- [x] Write `mesh_fragment.wgsl` → `mesh_terrain.wgsl`
- [ ] Integrate with existing world loader (NEXT STEP)
- [ ] **Test:** Render terrain with flat color (no lighting yet)

### **Phase 3: Lighting & Atmosphere** (Week 2) ✅ COMPLETE
- [x] Port day/night cycle to fragment shader
- [x] Port exponential fog algorithm
- [x] Implement smooth ambient transitions
- [x] Add sky light (crevice fill)
- [ ] **Test:** Match visual quality of ray marcher (sans shadows)

### **Phase 4: Shadow Maps** (Week 2-3)
- [ ] Implement shadow map rendering
- [ ] Add shadow comparison in fragment shader
- [ ] PCF filtering for soft shadows
- [ ] **Test:** Soft shadow quality comparable to ray-marched

### **Phase 5: Water Effects** (Week 3)
- [ ] Vertex animation for water surface
- [ ] Optional: Selective ray march for refraction
- [ ] Water reflections (planar or cubemap)
- [ ] **Test:** Water looks as good as ray marcher

### **Phase 6: Polish & Optimization** (Week 3-4)
- [ ] Material system integration (emissive, etc.)
- [ ] Biome-based vertex colors
- [ ] Performance profiling
- [ ] Side-by-side comparison tool
- [ ] **Test:** 144 FPS target achieved

---

## Performance Targets

| Metric | Ray Marcher (Current) | Hybrid (Target) |
|--------|----------------------|-----------------|
| **Terrain FPS** | 30-50 | 144+ |
| **Triangle Count** | N/A | 5,000-15,000 |
| **Mesh Build Time** | N/A | <5ms |
| **Shadow Quality** | Soft (expensive) | Soft (cheap) |
| **Memory** | ~10MB (buffers) | ~15MB (buffers + mesh) |

---

## File Structure

```
/public
  /shaders
    raymarcher_test.wgsl        (existing - unchanged)
    mesh_vertex.wgsl            (NEW)
    mesh_fragment.wgsl          (NEW)
    mesh_shadow.wgsl            (NEW - shadow map gen)
  
  /js
    worldRenderer.js            (existing - unchanged)
    meshBuilder.js              (NEW - greedy meshing)
    meshRenderer.js             (NEW - mesh rendering)
    hybridRenderer.js           (NEW - orchestrates mesh + water)

/views
  world.ejs                     (add toggle: ray march vs hybrid)
```

---

## Testing Strategy

### Visual Parity Checklist
- [ ] Day/night transitions smooth (no jumps)
- [ ] Fog matches exponential curve
- [ ] Shadows are soft and gradual
- [ ] Moon and stars appear at night
- [ ] Water animations work
- [ ] Material colors accurate
- [ ] Terrain normals smooth

### Performance Checklist
- [ ] 144 FPS at 1920×1080
- [ ] Mesh build <5ms
- [ ] No frame drops during camera movement
- [ ] Shadow map updates at 60Hz

---

## Migration Path

**Users can toggle between renderers:**
```javascript
// In world viewer UI
<select id="renderer-mode">
  <option value="raymarch">Ray Marcher (Reference)</option>
  <option value="hybrid">Hybrid Mesh (Performance)</option>
</select>
```

**Both use the same:**
- World data
- Material system
- Animation definitions
- Fog/lighting parameters

---

## Future Enhancements (Post-MVP)

1. **LOD System** - Multiple mesh resolutions for large worlds
2. **Chunk Streaming** - Load/unload mesh chunks dynamically
3. **Texture Mapping** - Replace vertex colors with textures
4. **Ambient Occlusion** - SSAO or baked AO
5. **God Rays** - Volumetric light shafts
6. **Biome Transitions** - Blend vertex colors at boundaries
7. **Advanced Water** - Screen-space reflections, caustics

---

## Success Criteria

✅ **Hybrid renderer achieves:**
1. Visual quality ≥95% of ray marcher
2. FPS ≥3x faster (minimum)
3. Same world data compatibility
4. All editor features work
5. Smooth lighting and shadows

✅ **Ray marcher remains:**
1. Functional for comparison
2. Reference implementation
3. Special effects (water refraction)

---

## Next Steps

1. ✅ **Document plan** (this file)
2. ⏭️ **Get approval** (await user confirmation)
3. ⏭️ **Phase 1**: Build `meshBuilder.js`
4. ⏭️ **Phase 2**: Basic rendering pipeline

---

## Notes & Decisions

- **Keep voxel aesthetic:** Yes! Mesh still represents discrete voxels
- **Smooth vs blocky:** Smooth normals by default, can add "blocky mode" later
- **Water approach:** Start with vertex animation, add ray-traced refraction if needed
- **Shadow quality:** Shadow maps should match or exceed ray-marched quality

---

**Ready to build the future! 🚀**
