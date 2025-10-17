# Local t_start Fix - Chunk Boundary Bug

## User's Critical Observation:
- **Camera chunk looks perfect** (Image 1 right side, from below)
- **Other chunks corrupted** (Image 1 left side, Image 2 everywhere)
- **32×32 boundaries visible** in corruption pattern
- **"Perfect region" follows camera** position, not screen position

## Root Cause: Mixed Coordinate Spaces in t_start

### The Bug:
```wgsl
// Step 1: Calculate t_start in WORLD space
let t0_chunk = (chunk_min_world - ray_origin_world) * inv_ray_dir;
let t_start = max(t_enter, 0.0);  // World-space parametric distance

// Step 2: Convert origin to LOCAL space
let local_origin = worldToChunkLocal(ray_origin, chunkIdx);  // Subtract offset

// Step 3: Test nodes using LOCAL origin
let t0 = (node_min - local_origin) * inv_ray_dir;  // Local-space parametric distance

// Step 4: Compare mixed-space t values
if (t_far < t_start) continue;  // ❌ Comparing LOCAL t against WORLD t_start!
```

### Why This Breaks at Chunk Boundaries:

**Camera INSIDE chunk** (e.g., at world pos 100, chunk at 96):
```
World space:
  t_enter = -∞ (camera inside)
  t_start = 0 ✓

Local space (origin = 100 - 96 = 4):
  Nodes at 0-32 local
  t values calculated from local_origin = 4
  t_start = 0 matches because camera is inside
```

**Camera OUTSIDE chunk** (e.g., at world pos 50, chunk at 96):
```
World space:
  t_enter = 46 / ray_dir (distance to chunk)
  t_start = 46 ✓

Local space (origin = 50 - 96 = -46):
  Nodes at 0-32 local
  t values calculated from local_origin = -46
  Node at 0 has t = (0 - (-46)) * inv = 46 (in local space)
  But t_start = 46 (in WORLD space)
  
  ❌ These are NOT the same 46!
  World t_start means "46 units from world origin"
  Local t means "46 units from LOCAL origin"
  Different starting points = wrong comparison!
```

### The Fix:

Calculate `t_start` in the **same coordinate space** used for node tests:

```wgsl
// World-space test for early rejection (cheap)
let t0_chunk_world = (chunk_min_world - ray_origin) * inv_ray_dir;
if (t_enter > t_exit || t_exit < 0.0) return hit;  // Early out

// Convert to local space
let local_origin = worldToChunkLocal(ray_origin, chunkIdx);

// Recalculate t_start in LOCAL space
let chunk_min_local = vec3(0.0);
let chunk_max_local = vec3(32.0);
let t0_local = (chunk_min_local - local_origin) * inv_ray_dir;
let t_enter_local = max(max(tmin_local.x, tmin_local.y), tmin_local.z);
let t_start = max(t_enter_local, 0.0);  // LOCAL-space t_start

// Now all t values are in the same space!
```

## Why "Perfect Region Follows Camera":

- **Camera chunk** (0,4,0): local_origin ≈ (camera % 32), t_start ≈ 0
  - Works because t_start calculation happens to be correct when camera is inside
  
- **Adjacent chunks** (1,4,0): local_origin = camera - (32,128,0) = negative
  - Breaks because t_start is from WRONG origin
  - As you move right, different chunks become "camera chunk"
  - Perfect region = chunks where camera is inside (t_start = 0 works)

## Expected Result:

✅ **All chunks render correctly** (not just camera chunk)
✅ **No 32×32 boundary artifacts**
✅ **Uniform quality everywhere**
✅ **Perfect region fills entire view**
✅ **Works from any camera position**

## Technical Note:

The parametric distance `t` is **NOT** invariant under translation when you:
1. Calculate t from one origin
2. Use it with tests from a different origin

Both origins must be consistent! The reference shader never changes origin, so it works. Our chunked version DOES change origin (to local), so we must recalculate t_start.
