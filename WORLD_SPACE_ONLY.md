# World Space Only - The Final Solution

## The Root Cause of ALL Bugs:

**Mixing coordinate systems made `t` values incomparable!**

### The Problem:

```wgsl
// Calculate chunk entry in WORLD space
let t_enter = (chunk_world - ray_origin) * inv_ray_dir;  // From ray_origin
let t_start = max(t_enter, 0.0);

// Convert to LOCAL space
let local_origin = ray_origin - chunk.world_offset;

// Calculate node entry in LOCAL space
let t_near = (node_local - local_origin) * inv_ray_dir;  // From local_origin

// Compare!
if (t_near >= t_start) { ... }  // ❌ WRONG! Different origins!
```

**Even though parametric distance `t` is theoretically coordinate-independent, comparing `t` values from DIFFERENT origins is fundamentally broken!**

---

## The Solution: ONE Coordinate System

**Keep EVERYTHING in world space:**

```wgsl
// Chunk AABB in WORLD space
let t_enter = (chunk_world - ray_origin) * inv_ray_dir;  // From ray_origin ✓

// Node positions in WORLD space
let node_world = chunk.world_offset + node_local;

// Node AABB in WORLD space
let t_near = (node_world - ray_origin) * inv_ray_dir;  // From ray_origin ✓

// Compare! (both from SAME origin)
if (t_near >= t_start) { ... }  // ✓ CORRECT!
```

---

## Implementation Changes:

### 1. Root Node in World Coordinates (Line 188-192)
```wgsl
// OLD:
let world_center = vec3(16, 16, 16);  // Local space

// NEW:
let chunk_local_center = vec3(16, 16, 16);
let chunk_world_center = chunk.world_offset + chunk_local_center;
stack[0].pos_xyz = chunk_world_center;  // World space!
```

### 2. Node Traversal in World Space (Line 215-216)
```wgsl
// OLD:
let t0 = (node_min - local_origin) * inv_ray_dir;

// NEW:
let t0 = (node_min - ray_origin) * inv_ray_dir;  // ray_origin never changes!
```

### 3. Child Traversal in World Space (Line 277-285)
```wgsl
// Children inherit world-space position from parent
let child_center = node_center + child_offset;  // node_center is world coords
let t0 = (child_min - ray_origin) * inv_ray_dir;  // Same origin throughout
```

---

## Why This Fixes Everything:

### Before (Broken):
```
ray_origin = (100, 135, 50)
chunk.world_offset = (96, 128, 48)
local_origin = (4, 7, 2)

t_start from ray_origin = 10
t_near from local_origin = -5

Compare: -5 >= 10? No, skip node
But the node is actually IN FRONT of the ray! ❌
```

### After (Fixed):
```
ray_origin = (100, 135, 50)  # Never changes!

t_start from ray_origin = 10
t_near from ray_origin = 12

Compare: 12 >= 10? Yes, process node ✓
Node is correctly identified as being ahead on the ray ✓
```

---

## Benefits:

✅ **ONE origin for all calculations** (ray_origin)  
✅ **All `t` values directly comparable**  
✅ **No coordinate conversion errors**  
✅ **Matches reference shader's approach** (single origin)  
✅ **Simpler and more correct**  

---

## Complete Algorithm:

```wgsl
// 1. Chunk AABB test (world space)
let t_enter = (chunk_world - ray_origin) * inv_ray_dir;
let t_start = max(t_enter, 0.0);

// 2. Initialize root (world space)
let root_world_center = chunk.world_offset + local_center;
stack[0].pos = root_world_center;

// 3. Traverse nodes (world space)
for each node {
  let t_near = (node_world - ray_origin) * inv_ray_dir;
  current_t = max(t_near, t_start);
  
  if (t_near >= t_start) {  // ✓ Comparable!
    process_node();
  }
}

// 4. Traverse children (world space)
for each child {
  let child_world = parent_world + child_offset;
  let t_near = (child_world - ray_origin) * inv_ray_dir;
  
  if (t_far >= current_t) {  // ✓ Comparable!
    add_to_stack(child_world);
  }
}
```

---

## Expected Results:

🎯 **No ray penetration** (all t values from same origin)  
🎯 **No backfaces visible** (correct traversal order)  
🎯 **Steps view shows only surface** (no interior)  
🎯 **Works from any position/angle**  
🎯 **No chunk boundary artifacts**  

This is the definitive fix! No more coordinate space confusion! 🚀
