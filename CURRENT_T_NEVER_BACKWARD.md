# current_t Must Never Go Backward!

## The Final Bug:

**`current_t` was being reset to node entry points that were BEFORE the chunk entry!**

### Example of the Bug:

```
Camera outside chunk, looking in
Ray enters chunk at t=50 (t_start = 50)

Processing root node:
  Root spans entire chunk (local 0-32)
  Camera at local (-46, 7, 0) - OUTSIDE and to the LEFT
  Root t_near = -46 (ray enters root from the left, before entering chunk!)
  
OLD CODE:
  current_t = max(t_near, 0.0) = max(-46, 0.0) = 0
  Accept root! Process its children at t=0
  These are BEHIND the camera! ❌
  
NEW CODE:
  current_t = max(max(t_near, 0.0), t_start) = max(max(-46, 0.0), 50) = 50
  Skip root's interior children (t < 50)
  Only process geometry at or after chunk entry ✓
```

---

## The Fix:

### Line 222:
```wgsl
// OLD:
current_t = max(t_near, 0.0);  // Can go before t_start!

// NEW:
current_t = max(max(t_near, 0.0), t_start);  // Never before chunk entry!
```

### Key Insight:

- Reference shader: ONE origin (ray_origin), traverses from world root
  - `current_t = max(t_near, 0.0)` works because root t_near = world entry
  
- Chunked shader: TWO stages
  1. Find chunk entry in WORLD space → t_start
  2. Traverse octree in LOCAL space → t_near
  - Must ensure `current_t >= t_start` to not process pre-entry geometry!

---

## Why This Fixes "Stepping Inside":

### Before (Broken):
```
Enter chunk at t=50
Process root: t_near=-46, current_t=0 ❌
Process children at t=0 (way behind entry!)
Hit interior voxels that ray already passed
Steps view shows blue interior structure ❌
```

### After (Fixed):
```
Enter chunk at t=50
Process root: t_near=-46, current_t=max(-46, 50)=50 ✓
Process children only if t_far >= 50
Skip all interior nodes before entry
Steps view shows only surface ✓
```

---

## The Complete Algorithm:

```wgsl
// 1. Calculate chunk entry (WORLD space)
let t_enter = (chunk_min_world - ray_origin) * inv_ray_dir;
let t_start = max(t_enter, 0.0);

// 2. Convert to LOCAL space
let local_origin = worldToChunkLocal(ray_origin, chunkIdx);

// 3. Initialize traversal
var current_t = t_start;  // Start at chunk entry

// 4. For each node:
current_t = max(max(t_near, 0.0), t_start);  // ✓ Never go before entry!

// 5. For each child:
if (t_near <= t_far && t_far >= current_t) {  // ✓ Skip if entirely behind current pos
  add_to_stack(child);
}
```

---

## Expected Results:

✅ **No interior structure in steps view**
✅ **Only surface voxels visible**
✅ **Works from any camera position** (inside/outside chunk)
✅ **Works at any angle** (straight down, diagonal, shallow)
✅ **Chunk boundaries seamless**
✅ **No "x-ray vision" into terrain**

---

## Technical Notes:

### Why t_start and t_near are Comparable:

Even though calculated from different origins (world vs local), the parametric distance `t` is:
```
t = (target - origin) · direction / |direction|²

With offset translation:
t_local = ((target - offset) - (origin - offset)) · direction / |direction|²
t_local = (target - origin) · direction / |direction|²
t_local = t_world  ✓ SAME VALUE!
```

So `max(t_near, t_start)` correctly compares local-space and world-space t values!

---

This should be the FINAL fix for ray penetration! 🎯
