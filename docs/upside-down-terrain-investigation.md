# Upside-Down Terrain Bug - Investigation Report

**Date**: October 21, 2025  
**Issue**: SVDAG terrain renders inverted (solid ground at top, air at bottom)  
**Status**: 🔴 UNRESOLVED

---

## Problem Statement

The voxel terrain renders completely upside down. Terrain that should be on the ground appears hanging from above. Camera movement is counterintuitive - pressing SPACE (which increases Y coordinate) makes the camera appear to go DOWN into the terrain.

### Current Symptoms
- ✅ Terrain generates correctly (verified via console logging)
- ✅ Chunk hash table lookups work
- ✅ Multi-chunk rendering works
- ❌ **Terrain hangs from above instead of resting on ground**
- ❌ **Camera Y-axis behavior is inverted relative to scene**
  - SPACE: Y increases → camera moves DOWN (into terrain)
  - SHIFT: Y decreases → camera moves UP (away from terrain)

### Visual Evidence
Latest screenshot shows:
- Green terrain suspended from top of view
- Blue sky at bottom
- Terrain surface has correct detail/features but wrong orientation
- Camera at Y=150 is looking UP at terrain instead of down

---

## Coordinate System Facts

### Voxel Array Structure
```javascript
// Standard 3D array indexing: Z-Y-X order
idx = z * 32 * 32 + y * 32 + x
// Where: z,y,x ∈ [0, 31]
```

### Chunk Coordinate System
```javascript
worldX = cx * 32 + voxX  // Chunk X * size + local X
worldY = cy * 32 + voxY  // Chunk Y * size + local Y
worldZ = cz * 32 + voxZ  // Chunk Z * size + local Z
```

### Terrain Generation Logic
```javascript
const surfaceHeight = heightValue * 256;  // ~120 typical
if (worldY < surfaceHeight) {
  voxels[idx] = 1;  // Solid
} else {
  voxels[idx] = 0;  // Air
}
```

### Console Output Confirms Correct Generation
```
cy=1: worldY=32-63, surface=120.7, expect=ALL_SOLID ✓
cy=2: worldY=64-95, surface=120.7, expect=ALL_SOLID ✓
cy=3: worldY=96-127, surface=120.7, expect=PARTIAL ✓
```

**Conclusion**: The data being generated is logically correct!

---

## Attempted Fixes

### Attempt #1: Y-Flip in Voxel Array (PARTIAL SUCCESS)
**Date**: Initial debugging session  
**Change**: `idx = z*32*32 + (31-y)*32 + x`  
**Theory**: Invert Y-axis during voxel array writing to compensate for rendering issue

**Results**:
- ✅ L-pattern test chunks rendered correctly (bases at bottom, walls rising up)
- ✅ Single Y-level terrain (cy=2 only) rendered correctly
- ❌ Full terrain across all Y-levels still upside down
- ❌ Created confusing "two pieces of terrain" artifact

**Why It Failed**: 
This fixed the internal orientation within each 32³ chunk, but didn't fix how chunks are stacked vertically. The shader still interprets chunk positions in an inverted way.

**Code Location**: `server/routes/chunksv2.js` lines 290-292

---

### Attempt #2: Negate Chunk Y in GPU Upload (COMPLETE FAILURE)
**Date**: Mid-debugging  
**Change**: `floatView[floatOffset + 1] = -chunk.cy * 32`  
**Theory**: Flip the chunk Y-coordinate when uploading to GPU to reverse stacking order

**Results**:
- ❌ Only 1-2 chunks visible
- ❌ Most terrain disappeared
- ❌ Hash table lookups failed

**Why It Failed**:
The shader computes chunk coordinates from `world_offset` using:
```wgsl
let cy = i32(floor(chunk.world_offset.y / 32.0));
```
Then uses `cy` to compute hash for lookups. Negating `world_offset.y` makes computed `cy` negative, breaking hash table matching.

**Code Location**: `public/js/chunkedSvdagRenderer.js` lines 1009, 1531

---

### Attempt #3: Invert Camera Controls (WORKAROUND REJECTED)
**Date**: Mid-debugging  
**Change**: 
```javascript
if (this.keys['Space']) {
  this.camera.position[1] -= speed; // INVERTED
}
```
**Theory**: Accept inverted world, flip camera controls to compensate

**Results**:
- ⚠️ Made controls "feel" normal
- ❌ Camera Y-values became confusing (increasing Y = going down)
- ❌ Didn't fix visual appearance
- ❌ Masked underlying bug instead of fixing it

**Why We Rejected It**: 
This is a workaround, not a fix. It would cause confusion for any future features using Y-coordinates and doesn't address the root cause.

**Code Location**: `public/js/chunkedSvdagRenderer.js` lines 697-702

---

### Attempt #4: Flip Octant Y-Bit in SVDAG Builder (CATASTROPHIC FAILURE)
**Date**: Late debugging  
**Change**: `const flippedOctant = i ^ 2; children[flippedOctant] = child;`  
**Theory**: The octree Y-axis encoding is backwards; XOR bit 1 to swap top/bottom octants

**Results**:
- ❌ Terrain completely disappeared
- ❌ Only small fragments visible
- ❌ Obvious octree traversal corruption

**Why It Failed**:
Changing the octant encoding during building without changing the shader's traversal code breaks the octree structure completely. The shader expects children at specific indices based on the standard octant layout.

**Code Location**: `server/services/svdagBuilder.js` lines 110-113

---

### Attempt #5: Remove All Hacks - Clean Slate (CURRENT STATE)
**Date**: Latest  
**Changes**:
- Removed Y-flip in voxel indexing (back to `idx = z*32*32 + y*32 + x`)
- Removed Y-negation in GPU upload (back to `chunk.cy * 32`)
- Restored normal camera controls (SPACE increases Y)

**Results**:
- ✅ Full terrain renders
- ✅ All chunks load correctly
- ✅ Voxel data verified correct via logging
- ❌ **Terrain still upside down**

**Key Insight**: 
With ALL modifications removed and everything using standard conventions, the terrain is STILL upside down. This proves the bug is **inherent to the rendering system**, not introduced by our code.

---

## Root Cause Analysis

### What We've Eliminated
1. ✅ Voxel data generation - Confirmed correct via console logging
2. ✅ Chunk coordinate calculations - Confirmed correct
3. ✅ Hash table implementation - Works perfectly
4. ✅ GPU upload/buffer layout - No issues found

### What Remains Suspect

#### 1. SVDAG Octant Encoding (HIGH PROBABILITY)
**File**: `server/services/svdagBuilder.js`  
**Lines**: 102-105

```javascript
for (let i = 0; i < 8; i++) {
  const cx = x + (i & 1 ? halfSize : 0);
  const cy = y + (i & 2 ? halfSize : 0);
  const cz = z + (i & 4 ? halfSize : 0);
}
```

**The Issue**:
- Octant index `i` has bit layout: `[Z][Y][X]`
- When bit 1 is set (`i & 2`), we ADD `halfSize` to Y
- This makes octants 2,3,6,7 the "upper" half
- But shader might interpret this backwards

**Standard Octant Layout**:
```
Octant 0: (0,0,0) - bottom-front-left
Octant 1: (1,0,0) - bottom-front-right
Octant 2: (0,1,0) - top-front-left      ← Bit 1 set
Octant 3: (1,1,0) - top-front-right     ← Bit 1 set
...
```

If the shader traverses assuming octant 0 is TOP and octant 2 is BOTTOM, the entire Y-axis is inverted.

---

#### 2. Shader Octant Traversal (HIGH PROBABILITY)
**File**: `public/shaders/raymarcher_svdag_chunked.wgsl`  
**Lines**: 449-454

```wgsl
let cx = f32(octant & 1u);
let cy = f32((octant >> 1u) & 1u);
let cz = f32((octant >> 2u) & 1u);

// Calculate child CENTER in WORLD space
let child_offset = vec3<f32>(cx - 0.5, cy - 0.5, cz - 0.5) * child_size;
```

**The Issue**:
- `cy = (octant >> 1) & 1` extracts bit 1
- `cy=0` → `cy - 0.5 = -0.5` → offset DOWN from center
- `cy=1` → `cy - 0.5 = +0.5` → offset UP from center

This ASSUMES octant Y-bit maps to geometric up/down. But if the octree was built with opposite convention, traversal will be inverted.

---

#### 3. Camera Up Vector (LOW PROBABILITY)
**File**: `public/js/chunkedSvdagRenderer.js`  
**Lines**: 872-876

```javascript
const up = [
  -Math.sin(this.camera.yaw) * Math.sin(this.camera.pitch),
  Math.cos(this.camera.pitch),  // ← Should be positive for +Y up
  -Math.cos(this.camera.yaw) * Math.sin(this.camera.pitch)
];
```

**Analysis**:
- Middle component is `Math.cos(pitch)` which is positive when pitch=0
- This looks correct for a right-handed coordinate system with +Y up
- Unlikely to be the issue since camera movement itself works correctly

---

## Diagnostic Tests Needed

### Test 1: Half-Height Chunk Pattern
Create a test chunk with:
```javascript
for (let y = 0; y < 32; y++) {
  const material = (y < 16) ? 1 : 2;  // Bottom half vs top half
  voxels[z*1024 + y*32 + x] = material;
}
```

**Expected**: Bottom half (y<16) renders at BOTTOM of chunk visually  
**If Inverted**: Bottom half renders at TOP of chunk visually

---

### Test 2: Single Voxel at Known Position
Place a single solid voxel at y=0 (bottom of chunk):
```javascript
voxels[16*1024 + 0*32 + 16] = 1;  // Center X,Z, bottom Y
```

**Expected**: Voxel appears at BOTTOM of chunk space  
**If Inverted**: Voxel appears at TOP of chunk space

---

### Test 3: Check Against Reference Implementation
Compare our octant bit layout against:
- "Efficient Sparse Voxel Octrees" paper (Laine & Karras, 2010)
- Open-source SVDAG implementations
- Standard graphics convention for octree child ordering

---

## The Smoking Gun Evidence

From the retrieved memory, we have critical evidence:

> **Critical Finding**: The exact same code works at cy=2 but fails when applied to all Y levels.

This suggests:
- Individual chunks are internally correct
- The bug is in how **chunks relate to each other vertically**
- Likely issue: Shader traversal between chunks interprets Y-coordinates backwards

---

## Proposed Solution Path

### Step 1: Verify Octant Convention
Add debug logging to `svdagBuilder.js`:
```javascript
if (depth === 0 && cy === 64) {
  console.log(`Building octant ${i}: cy=${cy}, adds halfSize=${!!(i&2)}`);
}
```

### Step 2: Add Shader Debug Output
Modify shader to output which octants are traversed for a test ray aimed at known coordinates.

### Step 3: Try Systematic Bit Flips
Test flipping different bits in octant encoding to find which convention the shader expects:
- Flip X-bit: `i ^ 1`
- Flip Y-bit: `i ^ 2` ← Most likely
- Flip Z-bit: `i ^ 4`

### Step 4: Fix Either Builder or Shader
Once we identify the mismatch, fix ONE side to match the other's convention.

---

## Code Sections Involved

### Server-Side (Voxel Data → Octree)
1. `server/routes/chunksv2.js` - Terrain generation (lines 258-289)
2. `server/services/svdagBuilder.js` - Octree construction (lines 102-120)
3. `server/services/svdagBuilder.js` - Voxel indexing (line 222)

### Client-Side (Octree → Rendering)
1. `public/js/chunkedSvdagRenderer.js` - GPU upload (lines 1007-1011, 1529-1533)
2. `public/js/chunkedSvdagRenderer.js` - Camera controls (lines 697-702)
3. `public/shaders/raymarcher_svdag_chunked.wgsl` - Octree traversal (lines 430-490)

---

## Summary

After 5 distinct approaches and multiple debugging sessions:

**✅ What Works**:
- Voxel data generation (verified via logs)
- Chunk coordinate system
- Hash table lookups
- GPU buffer uploads
- Individual chunk rendering

**❌ What's Broken**:
- Y-axis interpretation somewhere between octree building and shader traversal
- Chunks appear stacked in reverse order (high Y at bottom, low Y at top)

**🎯 Most Likely Culprit**:
Mismatch between octant Y-bit convention in `svdagBuilder.js` (line 104) and shader interpretation in `raymarcher_svdag_chunked.wgsl` (line 450).

**Next Action**:
Implement diagnostic Test #1 (half-height pattern) to definitively prove whether the bug is in octree building or shader traversal.

---

## References
- SVDAG Paper: Laine & Karras (2010) "Efficient Sparse Voxel Octrees"
- Octree Child Ordering: Industry standard is XYZ bit layout (bit 0=X, 1=Y, 2=Z)
- Right-Handed Coordinates: +Y points up in most graphics systems
