# Prevent Interior Voxel Traversal Fix

## The Bug:

**We were allowing the ray to hit voxels it had already passed through!**

### Visual Example:

```
Camera at top of chunk (y=31) looking down
    ↓ ray
Chunk entry: t_start = 0 (camera inside)
    ↓
Voxel at y=0:
  t_near = 30 (ray reaches top of voxel)
  t_far = 31 (ray exits bottom of voxel)
    ↓
OLD CODE:
  current_t = max(t_near, t_start) = max(30, 0) = 30 ✓
  Hit accepted! ✓
  
NEW CODE:
  if (t_near < t_start) skip;  // 30 < 0? No, continue
  current_t = t_near = 30 ✓
  Hit accepted! ✓
```

Wait, that case works fine. Let me think of the problematic case...

### The ACTUAL Problem Case:

```
Camera OUTSIDE chunk looking IN at shallow angle
    →→→ ray (mostly horizontal, slight downward)
Chunk at ground level (y=128-160)
Camera at y=135 (middle of chunk)

Ray path crosses chunk from side:
  Enters chunk at x=0, y=140
  t_start = 50 (distance to reach x=0)
  
Interior voxels at y=130:
  t_near = 45 (ray would enter this y-level BEFORE entering chunk!)
  t_far = 55
  
OLD CODE:
  current_t = max(45, 50) = 50
  This puts us at x=0, y=135 - INSIDE the voxel at y=130!
  Hit reported! ❌ WRONG - we're inside the geometry!
  
NEW CODE:
  if (t_near < t_start) skip;  // 45 < 50? YES, SKIP! ✓
  Voxel not considered at all ✓
```

---

## The Fix:

### OLD (Broken):
```wgsl
let current_t = max(t_near, t_start);  // Can put us inside voxels!

if (t_far < t_start) {
  continue;  // Only skips if voxel is ENTIRELY before entry
}
// Accepts voxels that START before entry but END after!
```

### NEW (Fixed):
```wgsl
// Skip if ray ENTERS voxel before chunk entry
if (t_near < t_start) {
  continue;  // ✓ Prevents hitting voxels from inside
}

let current_t = t_near;  // Always use actual entry point
```

---

## Why This Matters:

### Camera Inside Chunk (Looking Down):
- All visible voxels have t_near > 0
- t_start = 0 (camera already inside)
- Check passes: t_near >= 0 ✓

### Camera Outside Chunk (Looking In):
- Some interior voxels have t_near < t_start
- These are voxels the ray would "pass through" before entering chunk
- Check fails: skip them ✓

### Diagonal Rays:
- Ray enters chunk at shallow angle
- Interior voxels along ray path have t_near < t_start
- All correctly skipped ✓

---

## Expected Results:

✅ **No blue interior structure in steps view**
✅ **Only surface voxels render**
✅ **Clean from all angles** (especially shallow/diagonal)
✅ **No "x-ray vision" into chunks**
✅ **Chunk boundaries clean** (no artifacts at edges)

---

## Technical Note:

The key insight:
```
t_near = when ray ENTERS voxel bounding box
t_start = when ray ENTERS chunk bounding box

If t_near < t_start:
  Ray would enter voxel BEFORE entering chunk
  This means we'd be hitting the voxel from INSIDE
  Must skip!
```

This is different from just checking `t_far < t_start` (voxel entirely before entry), which allows voxels that straddle the entry point.

---

## Applied To:

1. **Line 226**: Node traversal - skip nodes where ray enters before chunk entry
2. **Line 293**: Child traversal - don't add children where ray enters before chunk entry

Both use the same logic: `if (t_near < t_start) skip;`

This ensures we ONLY traverse geometry the ray actually hits, not geometry it's already inside! 🎯
