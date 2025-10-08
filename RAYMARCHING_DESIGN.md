# Ray Marching System Design

## Overview
A hierarchical voxel-based ray marching system for rendering procedurally generated terrain with water, using WebGPU compute shaders.

## World Coordinate System

### Voxel Grid
- **Voxel size**: 0.333m (1/3 meter) per voxel
- **Map coordinates**: 0-1 normalized space
- **World space**: Map normalized coords → world meters
- **Texel sampling**: Clamp ray position to voxel center, map to texel coordinate

### Example Mapping
```
Map coord [0.5, 0.5] → World [256m, 256m] (512×512 map)
World [256m, 256m] → Voxel [768, 768] (at 0.333m/voxel)
Voxel [768, 768] → Texel [256, 256] (sample map at center)
```

## Data Maps

### Required Maps (512×512 base resolution)

#### 1. Height Map (`Float32Array`)
- **Values**: 0-1 normalized terrain elevation
- **LOD versions**: 4 levels with MAX pooling
  - LOD 0: 512×512 (original, 1m/texel)
  - LOD 1: 128×128 (4×4 max pool, 4m/texel)
  - LOD 2: 32×32 (16×16 max pool, 16m/texel)
  - LOD 3: 8×8 (64×64 max pool, 64m/texel)
- **Why MAX not AVERAGE?**: Prevents ray from incorrectly skipping through peaks

#### 2. Water Map (`Float32Array`)
- **Values**: Water depth at each point (0 = no water)
- **Usage**: Determines water surface height

#### 3. Terrain Block Map (`Uint16Array`)
- **Values**: Block type ID (0-65535)
- **Usage**: Surface/underwater terrain blocks

#### 4. Water Block Map (`Uint16Array`)
- **Values**: Water block type ID (0-65535)
- **Usage**: Water volume blocks (biome-specific water types)

#### 5. Block Definitions
```javascript
{
  id: uint16,
  name: string,
  color: hex,
  transparent: 0-1,    // 0=opaque, 1=fully transparent
  emissive: 0-1,       // Self-illumination
  reflective: 0-1,     // Mirror-like reflection
  refractive: 1-3      // IOR (1.0=air, 1.33=water, 1.5=glass)
}
```

## Ray Marching Algorithm

### Hierarchical LOD Traversal

```
Phase 1: Coarse Test (LOD 3 - 8×8, 64m per texel)
  - March ray at 64m steps
  - Sample LOD 3 height map
  - If |rayHeight - terrainHeight| < threshold:
      → Drop to LOD 2
  - Else: continue at LOD 3

Phase 2: Medium Test (LOD 2 - 32×32, 16m per texel)
  - March ray at 16m steps
  - Sample LOD 2 height map
  - If |rayHeight - terrainHeight| < threshold:
      → Drop to LOD 1
  - Else: continue at LOD 2 or return to LOD 3

Phase 3: Fine Test (LOD 1 - 128×128, 4m per texel)
  - March ray at 4m steps
  - Sample LOD 1 height map
  - If |rayHeight - terrainHeight| < threshold:
      → Drop to full resolution
  - Else: continue at LOD 1 or return to LOD 2

Phase 4: Full Resolution (512×512, 1m per texel)
  - March ray at 0.333m (voxel) steps
  - Sample full height + water maps
  - Detect surface intersection
  - Sample terrain/water block maps
  - Return block properties
```

### Surface Detection

```javascript
// Determine if ray hit surface
if (waterDepth > 0.01) {
  // Check if ray at water surface level
  const waterSurfaceHeight = terrainHeight + waterDepth;
  if (rayHeight <= waterSurfaceHeight && rayHeight > terrainHeight) {
    // Hit water surface
    blockId = waterBlockMap[texelIdx];
    isWater = true;
  } else if (rayHeight <= terrainHeight) {
    // Hit terrain (underwater or dry)
    blockId = terrainBlockMap[texelIdx];
    isWater = false;
  }
} else {
  // No water, check terrain
  if (rayHeight <= terrainHeight) {
    blockId = terrainBlockMap[texelIdx];
    isWater = false;
  }
}
```

### Block Intersection

Two approaches:

#### Option A: SDF (Signed Distance Function)
```wgsl
fn sdBox(p: vec3<f32>, b: vec3<f32>) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}
```

#### Option B: DDA (Digital Differential Analyzer)
- Pre-compute ray step through voxel grid
- More accurate for axis-aligned blocks
- Better for Minecraft-style rendering

## Material System

### Block Properties → Rendering

```javascript
// Opaque surface (transparent = 0)
if (block.transparent < 0.01) {
  color = block.color;
  applyLighting(color, normal, lightDir);
  if (block.emissive > 0) {
    color += block.color * block.emissive;
  }
  return color;
}

// Transparent surface (water, glass)
if (block.transparent > 0.01) {
  // Refraction
  if (block.refractive > 1.0) {
    refractedRay = refract(rayDir, normal, 1.0 / block.refractive);
    underwaterColor = marchRay(hitPos, refractedRay);
    color = mix(block.color, underwaterColor, block.transparent);
  }
  
  // Reflection
  if (block.reflective > 0.01) {
    reflectedRay = reflect(rayDir, normal);
    reflectedColor = marchRay(hitPos, reflectedRay);
    color = mix(color, reflectedColor, block.reflective);
  }
  
  return color;
}
```

### Distance Fog

```wgsl
fn applyFog(color: vec3<f32>, distance: f32, fogColor: vec3<f32>) -> vec3<f32> {
  let fogStart = 100.0;  // meters
  let fogEnd = 500.0;    // meters
  let fogFactor = clamp((distance - fogStart) / (fogEnd - fogStart), 0.0, 1.0);
  return mix(color, fogColor, fogFactor);
}
```

### Underwater Rendering

When camera is underwater:
- First ray hit is water block
- Apply water color tint globally
- Increase fog density
- Optional: caustics from surface waves

## Texture Sampling (Future)

### Triplanar Mapping
```wgsl
fn triplanarSample(pos: vec3<f32>, normal: vec3<f32>, texture: texture_2d<f32>) -> vec4<f32> {
  let weights = abs(normal);
  weights = weights / (weights.x + weights.y + weights.z);
  
  let xy = textureSample(texture, sampler, pos.xy);
  let xz = textureSample(texture, sampler, pos.xz);
  let yz = textureSample(texture, sampler, pos.yz);
  
  return xy * weights.z + xz * weights.y + yz * weights.x;
}
```

## Performance Optimizations

### 1. Early Ray Termination
- Max ray distance (e.g., 1000m)
- Opacity accumulation for transparent blocks

### 2. Adaptive Step Size
- Large steps in LOD 3 (64m)
- Small steps in full res (0.333m)
- Dynamic adjustment based on terrain complexity

### 3. Compute Shader Parallelism
- One thread per screen pixel
- 8×8 workgroups for GPU efficiency

### 4. Memory Layout
- Coalesced memory access
- Texture cache-friendly sampling patterns

## Implementation Phases

### Phase 1: LOD Height Maps ✅ (Next)
- Create `HeightLODNode`
- GPU shader for max-pooling downsampling
- Output 4 LOD levels (512, 128, 32, 8)

### Phase 2: Export System
- Binary export of all maps
- JSON export of block definitions
- Format for ray marcher consumption

### Phase 3: Basic Ray Marcher
- Simple single-level ray marching
- Height-only intersection
- Flat color from terrain blocks
- Distance fog

### Phase 4: Hierarchical LOD
- Multi-level traversal
- Air skipping optimization
- Performance profiling

### Phase 5: Water & Transparency
- Water surface detection
- Refraction ray casting
- Reflection ray casting
- Underwater fog

### Phase 6: Advanced Materials
- Triplanar texturing
- Normal mapping
- Emissive blocks (glow)
- Caustics

## Technical Notes

### Coordinate Conventions
- **Map space**: [0,1] × [0,1]
- **World space**: [0,512m] × [0,512m] (for 512×512 map)
- **Voxel space**: [0,1536] × [0,1536] (at 0.333m/voxel)
- **Y-axis**: Up (positive = higher elevation)

### Precision Considerations
- Float32 for positions (sufficient for 512m world)
- Uint16 for block IDs (65k unique blocks)
- Use `fract()` carefully near boundaries

### Edge Cases
- Ray origin below terrain → immediate hit
- Ray origin in water → water block first
- Ray parallel to ground → LOD prevents infinite loop
- Map boundaries → clamp or wrap sampling

## Future Enhancements

- **Biome-aware fog colors** (desert = yellow, forest = green tint)
- **Time-of-day lighting** (sun position, sky color)
- **Shadow rays** (march toward sun for shadows)
- **Ambient occlusion** (sample nearby voxels)
- **Depth of field** (ray cone tracing)
- **Motion blur** (temporal accumulation)

## References

- DDA Voxel Traversal: Amanatides & Woo (1987)
- Distance Functions: Inigo Quilez (iquilezles.org)
- Ray Marching: Sebastian Lague, Shadertoy examples
- WebGPU Compute: webgpu.rocks, Andi Smith's tutorials
