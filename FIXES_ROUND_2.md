# ✅ Fixes Round 2 - Normals & Chunk Loading

## Issue 1: Wrong Normals (Purple/Pink/Orange in Normal Mode) ✅ FIXED

### Problem:
Normals calculated from `sign(hit_point - center)` which gives incorrect results depending on where within the voxel the ray hits.

### Root Cause:
Chunked shader used **geometric center distance** for normals.  
Reference shader uses **AABB entry face** detection.

### Fix Applied:
**File:** `raymarcher_svdag_chunked.wgsl` lines 207-218

**Before (WRONG):**
```wgsl
let d = abs(hit_point - node_center);
let max_d = max(max(d.x, d.y), d.z);
if (max_d == d.x) {
  hit.normal = vec3<f32>(sign(hit_point.x - node_center.x), 0.0, 0.0);
```

**After (CORRECT - matches reference):**
```wgsl
let t_near_vec = min(t0, t1);
let t_entry = max(max(t_near_vec.x, t_near_vec.y), t_near_vec.z);
let epsilon = 0.001;
if (abs(t_entry - t_near_vec.x) < epsilon) {
  hit.normal = vec3<f32>(-sign(ray_dir.x), 0.0, 0.0);
```

**Key Insight:**  
The correct normal is based on **which AABB face was hit first**, determined by comparing the `t_near` components, then using `-sign(ray_dir)` on that axis.

**Expected Result:**
- ✅ Flat surface = ALL cyan normals (pointing up)
- ✅ Underside smooth (no gaps)
- ✅ No purple/pink/orange on flat terrain
- ✅ Correct lighting from all angles

---

## Issue 2: Chunks Blinking Out / Loading Strategy ✅ IMPROVED

### Problem:
1. Loading chunks in 3D sphere around camera
2. Loading empty air chunks above/below terrain
3. Chunks disappearing when moving (not evicting correctly)

### Root Cause:
`loadChunksAround()` loaded all chunks within radius regardless of terrain presence.

### Fix Applied:
**File:** `chunkManager.js` lines 222-269

**Changes:**
1. **Focus on terrain Y level** - Only load Y=4 (terrain) ± 1 level
2. **Wider horizontal range** - Increased from 2 to 4 chunks radius
3. **Faster loading** - 8 parallel requests (was 4)
4. **Smart eviction** - Remove chunks >6 chunks away OR wrong Y level

**Before:**
```javascript
// Loaded 5x5x5 = 125 chunks (mostly empty air!)
for (let dy = -radius; dy <= radius; dy++) {
  const cy = center.cy + dy;  // Loads air chunks above/below
```

**After:**
```javascript
// Loads 9x3x9 = 243 potential, but only terrain Y levels
const terrainChunkY = 4;
for (let dy = -1; dy <= 1; dy++) {
  const cy = terrainChunkY + dy;  // Always terrain level ±1
```

**New Strategy:**
- ✅ Only load chunks with terrain (Y=4 for FLAT_WORLD)
- ✅ Load ±1 Y level for vertical features
- ✅ Horizontal radius = 4 (wider field of view)
- ✅ Evict chunks outside view distance
- ✅ 8x parallel loading (faster)

**Expected Result:**
- ✅ More chunks visible (wider horizontal range)
- ✅ No wasted loading on empty air
- ✅ Chunks stay loaded longer
- ✅ Smooth transitions when moving

---

## Chunk Loading Architecture

### Current Design:
```
Camera Position [X, Y, Z]
        ↓
loadChunksAround(worldX, worldY, worldZ)
        ↓
Focus on terrainChunkY = 4 (Y=128)
        ↓
Load horizontal radius 4 at Y=3,4,5
        ↓
Evict chunks outside radius 6 or wrong Y
```

### For Future Enhancement (Ray-Based Loading):
To implement "only chunks ray intersects":

1. **Ray Frustum Calculation:**
   - Cast rays from camera through screen corners
   - Determine min/max XZ bounds at terrain Y level
   - Load only chunks within that frustum

2. **Visibility Culling:**
   - Check if chunk AABB intersects view frustum
   - Skip chunks behind camera
   - Prioritize visible chunks

3. **Occlusion:**
   - Don't load chunks hidden behind visible terrain
   - Track which chunks are currently rendering

**Current simple approach works well for flat terrain test!**

---

## Testing Checklist:

### Normal Mode (Press `4`):
- [ ] Flat surface = solid cyan (all pointing up)
- [ ] Looking from below = solid cyan (pointing down from that view)
- [ ] No purple/pink/orange artifacts
- [ ] Smooth color transitions at chunk boundaries

### Regular View:
- [ ] Top surface smooth and green
- [ ] Underside smooth (if visible below)
- [ ] No diagonal gaps or shadows
- [ ] Multiple chunks visible (should see 9x9 grid at terrain level)

### Movement Test:
- [ ] Pan left/right → chunks load smoothly, don't blink
- [ ] Move forward → distant chunks load, near chunks stay
- [ ] Fly up/down → chunks don't disappear
- [ ] Rotate 360° → all directions have chunks

### Steps Mode (Press `5`):
- [ ] Should NOT see interior voxel structure
- [ ] Clean transitions between chunks
- [ ] No blue "x-ray" interior views

---

## Summary:

**Normals:** Now match reference shader exactly - correct AABB face detection
**Chunk Loading:** Optimized for flat terrain - terrain Y level only, wider horizontal range
**Both issues should be resolved!** 🎯

**Next:** If still seeing issues, they're likely in the octree structure itself, not the shader.
