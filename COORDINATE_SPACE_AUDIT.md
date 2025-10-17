# Coordinate Space Audit - Full Pipeline

## Space Definitions:

1. **World Space**: Absolute coordinates (e.g., camera at `(96, 135, -7)`)
2. **Local Space**: Chunk-relative (e.g., `world - chunk.world_offset`, range 0-32)
3. **Parametric Space**: Distance along ray (`P = origin + t * dir`)

---

## Current Flow Analysis:

### Entry Point: `raymarchChunks()`
```wgsl
fn raymarchChunks(ray_origin: vec3<f32>, ray_dir: vec3<f32>) -> Hit {
  // ray_origin: WORLD SPACE ✓
  // ray_dir: WORLD SPACE (direction, invariant under translation) ✓
  
  for each chunk {
    let chunk_hit = traverseSVDAG(ray_origin, ray_dir, chunkIdx, ...);
    // Expects: ray_origin in WORLD space
    // Returns: hit.distance in ??? space
  }
}
```

### Per-Chunk: `traverseSVDAG()`
```wgsl
fn traverseSVDAG(ray_origin: vec3<f32>, ray_dir: vec3<f32>, chunkIdx: i32) -> Hit {
  // INPUT: ray_origin in WORLD space
  
  // Step 1: World-space AABB test (for early rejection)
  let chunk_min_world = chunk.world_offset;
  let t0_chunk = (chunk_min_world - ray_origin) * inv_ray_dir;  // ✓ WORLD space
  
  // Step 2: Convert origin to LOCAL space
  let local_origin = worldToChunkLocal(ray_origin, chunkIdx);  // LOCAL space
  
  // Step 3: LOCAL-space AABB test for t_start
  let chunk_min_local = vec3(0.0);
  let t0_local = (chunk_min_local - local_origin) * inv_ray_dir;  // ✓ LOCAL space
  let t_start = max(t_enter_local, 0.0);  // LOCAL parametric
  
  // Step 4: Traverse octree in LOCAL space
  while (stack_size > 0) {
    let node_center = entry.pos_xyz;  // LOCAL space (0-32 range)
    let t0 = (node_min - local_origin) * inv_ray_dir;  // LOCAL parametric
    let current_t = max(t_near, t_start);  // LOCAL parametric
    
    if (hit_leaf) {
      hit.distance = current_t;  // ❌ LOCAL parametric!
      return hit;
    }
  }
}
```

### The Problem:

**`hit.distance` is in LOCAL parametric space, but used as WORLD parametric!**

```wgsl
// traverseSVDAG returns hit with:
hit.distance = current_t;  // Distance from LOCAL origin

// raymarchChunks compares:
if (chunk_hit.distance < min_distance) {  // Treats as distance from WORLD origin!
```

---

## The Fix Required:

Actually, **parametric `t` IS coordinate-invariant!** Let me verify:

### Parametric Distance is Invariant:

```
World space:
  P_world = ray_origin_world + t * ray_dir
  
Local space:
  P_local = local_origin + t * ray_dir
  P_local = (ray_origin_world - chunk_offset) + t * ray_dir
  
Converting back:
  P_world = P_local + chunk_offset
  P_world = (ray_origin_world - chunk_offset) + t * ray_dir + chunk_offset
  P_world = ray_origin_world + t * ray_dir  ✓

Same `t` value!
```

**So `t` should be the same!** But our `t_start` calculation might still be wrong...

Let me check if we're using the SAME `inv_ray_dir` for both world and local tests...

---

## Actual Bug:

Looking back at the code, we calculate `inv_ray_dir` ONCE at the top (from world-space ray_dir).

Then we use it for:
1. World-space AABB (lines 148-149) ✓
2. Local-space AABB (lines 172-173) ✓
3. Node AABB tests (lines 220-221) ✓

**This should be fine** because `ray_dir` is a DIRECTION (vector), which is translation-invariant!

---

## Wait... Let me check the actual bug more carefully:

The issue might be that when we do:
```wgsl
let t0_local = (chunk_min_local - local_origin) * inv_ray_dir;
```

If `local_origin` is OUTSIDE the chunk (negative values), then `t_enter_local` might be calculated incorrectly!

Example:
- Camera at world (50, 135, 0)
- Chunk at world (96, 128, 0)
- local_origin = (50-96, 135-128, 0-0) = (-46, 7, 0)
- chunk_min_local = (0, 0, 0)
- t0_local.x = (0 - (-46)) * inv_ray_dir.x = 46 * inv_ray_dir.x

If ray_dir.x = 1.0 (moving right):
- inv_ray_dir.x = 1.0
- t0_local.x = 46

This means "ray enters chunk at t=46 from local_origin"

But local_origin is at (-46, 7, 0) in local space, which is OUTSIDE the chunk (to the left).

The ray needs to travel 46 units to reach x=0 (left edge of chunk).

That's actually CORRECT!

---

## So where's the remaining bug?

Let me think about the symptoms:
- Perfect region follows CAMERA position (not screen position)
- Chunks where camera is INSIDE work perfectly
- Chunks where camera is OUTSIDE show corruption

Hmm, maybe the issue is that we're still doing something wrong with `t_start`...

Actually, I think the bug might be more subtle. Let me check if `current_t` is being calculated correctly.
