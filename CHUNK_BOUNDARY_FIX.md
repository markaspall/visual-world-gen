# Chunk Boundary Coordinate Fix

## Critical Bug Found

**Issue:** AABB intersection was done in MIXED coordinate spaces!

### Before (WRONG):
```wgsl
// Convert to local FIRST
let local_origin = worldToChunkLocal(ray_origin, chunkIdx);

// Then check chunk bounds (0 to 32) against LOCAL origin
let chunk_min = vec3(0.0);  // Local space
let chunk_max = vec3(32.0); // Local space
let t0 = (chunk_min - local_origin) * inv_ray_dir;  // ❌ WRONG!
```

**Problem:** Comparing local-space bounds (0-32) with a local-space origin that's been translated.  
**Result:** Incorrect `t_start` values, especially at chunk boundaries!

### After (CORRECT):
```wgsl
// Check chunk bounds in WORLD space
let chunk_min_world = chunk.world_offset;  // e.g., (0, 128, 0)
let chunk_max_world = chunk.world_offset + vec3(32.0);  // e.g., (32, 160, 32)
let t0 = (chunk_min_world - ray_origin) * inv_ray_dir;  // ✓ CORRECT!

// Get t_start in world-space parametric units
let t_start = max(t_enter, 0.0);

// THEN convert to local for octree traversal
let local_origin = worldToChunkLocal(ray_origin, chunkIdx);
```

**Key Insight:** The parametric distance `t` is invariant across coordinate translations.  
`P_world = ray_origin_world + t * ray_dir`  
`P_local = ray_origin_local + t * ray_dir`  
The SAME `t` value works in both spaces!

## Changes Made:

1. **Lines 136-143**: Chunk AABB test now in WORLD space
2. **Lines 149-161**: Better t_start handling (camera inside chunk case)
3. **Checkerboard pattern enabled** for visual debugging

## Expected Result:

- ✅ Correct t_start at ALL chunk boundaries
- ✅ No "ray inside voxel" artifacts
- ✅ Smooth transitions between chunks
- ✅ Underside renders correctly (no interior structure visible)

## Test with Checkerboard:

Should see alternating green/tan 1×1 squares with:
- Clean edges
- No gaps
- Smooth from all angles
- Correct undersides
