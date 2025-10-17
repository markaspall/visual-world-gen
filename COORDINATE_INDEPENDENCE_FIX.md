# Parametric Distance Coordinate Independence

## The Mathematical Truth:

**Parametric distance `t` IS coordinate-independent!**

### Proof:

```
Given:
  Point P in world space
  Ray: origin_world, direction

World calculation:
  P_world = origin_world + t_world * direction

Local calculation (after translating origin):
  origin_local = origin_world - chunk_offset
  P_local = P_world - chunk_offset
  P_local = origin_local + t_local * direction

Substituting:
  P_world - chunk_offset = (origin_world - chunk_offset) + t_local * direction
  P_world = origin_world + t_local * direction

Comparing with world equation:
  origin_world + t_world * direction = origin_world + t_local * direction
  t_world = t_local  ✓

Therefore: Same `t` in both coordinate systems!
```

---

## The Implementation:

### Final Coordinate Space Strategy:

```wgsl
// 1. Early rejection in WORLD space (cheap, catches misses early)
let chunk_min_world = chunk.world_offset;
let t0_world = (chunk_min_world - ray_origin_world) * inv_ray_dir;
let t_enter = ...;  // Parametric distance to chunk entry
if (miss) return;

// 2. Use this WORLD-space t_enter as t_start
let t_start = max(t_enter, 0.0);

// 3. Traverse octree in LOCAL space (nodes are 0-32)
let local_origin = worldToChunkLocal(ray_origin_world, chunkIdx);
let t_node = (node_min - local_origin) * inv_ray_dir;

// 4. Compare! (t_start from world, t_node from local, both valid!)
if (t_node >= t_start) {
  // Process node
}
```

**Key Insight:** Because `t` is coordinate-independent, we can calculate `t_start` in world space but use it with local-space node tests!

---

## Why This Fixes Everything:

### Before (Broken):
- Calculated `t_start` in world space from `ray_origin`
- Calculated `t_node` in local space from `local_origin`  
- These origins are at DIFFERENT positions
- **But we thought they weren't comparable!** (Wrong assumption)

### Reality:
- `t` represents "distance along ray" in parametric units
- This distance is the SAME regardless of coordinate system
- As long as we use the SAME `ray_dir` and `inv_ray_dir`, it works!

### After (Fixed):
- Calculate `t_start` in world space (line 166)
- Calculate `t_node` in local space (line 212-213)
- **They're directly comparable!** (Because `t` is coordinate-independent)
- All chunks return hit.distance in the same parametric units
- Comparison in `raymarchChunks` works correctly!

---

## Expected Results:

✅ **No more 32×32 grid artifacts** (all chunks use consistent `t` values)
✅ **Depth map correct** (near=small t=red, far=large t=blue)
✅ **Clean view everywhere** (not just camera chunk)
✅ **Smooth chunk boundaries** (no discontinuities)
✅ **Top-down perfect** (all chunks render consistently)

---

## Technical Notes:

### Why the confusion?

The confusion arose because:
1. We translate `origin` to local space
2. Intuitively, changing the origin should change distances
3. **But parametric distance `t` compensates automatically!**

The parametric equation `P = origin + t * direction` ensures that:
- If you move `origin` by `offset`
- The parametric `t` to reach the same point `P` stays the same
- Because the `direction` term scales with `t`

### Epsilon Protection:

Still critical! Without it:
```
ray_dir.x ≈ 0 → inv_ray_dir.x = inf → t values explode
```

With epsilon (line 137-143):
```
ray_dir.x < 1e-8 → use 1e-8 instead → bounded inv_ray_dir
```

---

## Summary:

**One coordinate system for AABB tests:** World space (early rejection)
**Another for octree traversal:** Local space (nodes are 0-32)
**Parametric `t` bridges them:** Coordinate-independent!

This elegant solution avoids duplicate calculations while maintaining correctness! 🎯
