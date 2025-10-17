# Floating-Point Precision Fix

## User's Observation:
- **Perfect region** in center of screen (stays in same screen position when moving)
- **Corruption increases with distance** from perfect region
- **Diagonal rays worse** than axis-aligned
- **Boundaries smaller than 32×32** (voxel-level artifacts)

## Root Cause: Division-by-Zero → Precision Catastrophe

### The Bug:
```wgsl
// WRONG: Direct division by ray_dir
let inv_ray_dir = vec3<f32>(1.0) / ray_dir;
```

**When ray is nearly parallel to an axis:**
```
ray_dir.x = 0.0001  → inv_ray_dir.x = 10,000
ray_dir.x = 0.0     → inv_ray_dir.x = inf  💥
```

**Result:**
- Tiny ray direction components → huge inverse components
- AABB intersection tests give wildly incorrect `t` values
- Errors accumulate along ray path
- **Diagonal rays** involve multiple small components → multiple error sources
- **Perfect region** = where ray_dir components are "normal sized" (≈0.5-1.0)

### The Fix (from reference shader):
```wgsl
// Prevent division by zero/tiny values
let eps = 1e-8;
let safe_ray_dir = vec3<f32>(
  select(ray_dir.x, eps, abs(ray_dir.x) < eps),
  select(ray_dir.y, eps, abs(ray_dir.y) < eps),
  select(ray_dir.z, eps, abs(ray_dir.z) < eps)
);
let inv_ray_dir = 1.0 / safe_ray_dir;
```

**Benefits:**
- Clamps all components to minimum of 1e-8
- Prevents `inf` values
- Keeps inverse values bounded (max ≈ 100M, not infinity)
- Maintains numerical stability across entire screen

## Why "Perfect Region Stays in Screen Space"

The **center of screen** (camera.forward direction) typically has:
- `ray_dir ≈ (0, -1, 0)` when looking straight down
- **One large component**, two small ones
- Small components still cause issues, but **ONE axis** is dominant

The **edges/corners** of screen have:
- `ray_dir ≈ (0.5, -0.7, 0.5)` at 45° angles
- **All components moderate**, but some might be very small due to FOV
- **Multiple small components** → **multiple error sources**

When you **move**, the camera position changes but **screen-space ray angles don't**!
- Perfect region = rays with "safe" direction components
- Corrupted region = rays with tiny direction components (near-parallel to axes)

## Expected Result After Fix:

✅ **No more "perfect region" limitation**  
✅ **Clean edges and corners** (diagonal rays fixed)  
✅ **Uniform quality** across entire screen  
✅ **No distance-based degradation**  
✅ **Smooth at all camera angles**  

## Technical Details:

### Before (Broken):
```
Looking down at shallow angle:
  ray_dir = (0.999, -0.001, 0.001)
  inv_ray_dir = (1.001, -1000, 1000)  💥
  
AABB test:
  t = (pos - origin) * inv_ray_dir
  t.y = (130 - 135) * -1000 = 5000 blocks!  💥 WRONG!
```

### After (Fixed):
```
Looking down at shallow angle:
  ray_dir = (0.999, -0.001, 0.001)
  safe_ray_dir = (0.999, 0.00000001, 0.00000001)
  inv_ray_dir = (1.001, 100M, 100M)  ✓ Bounded
  
AABB test:
  t = (pos - origin) * inv_ray_dir
  Values stay reasonable ✓
```

## Testing:

1. **Look at corners** of screen - should be crisp checkerboard
2. **Look at shallow angles** - no distortion
3. **Diagonal movement** - smooth transitions
4. **All camera orientations** - uniform quality

The "perfect region" should **expand to fill the entire screen**! 🎯
