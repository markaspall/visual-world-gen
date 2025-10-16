# 🎯 Debug Task List

## Current Status
- **Flat test chunk enabled:** ✅
- **Camera position:** [2, 155, 32] (from screenshot)
- **Expected chunk:** (0,4,0) at world [0-32, 128-160, 0-32]
- **Result:** Vertical colored bands (WRONG - should be horizontal plane)

---

## Priority 1: CRITICAL BUGS 🚨

### ❌ Task 1.1: Vertical Bands (Axis Swap?)
**Symptom:** Seeing vertical colored stripes instead of horizontal plane  
**Expected:** Flat green plane (32×32 voxels at y=128)  
**Suspect:** 
- SVDAG voxel indexing doesn't match shader traversal
- Octree child ordering wrong
- Ray traversal reading wrong axis

**Test:**
```javascript
// In debug chunk generation, make a CHECKERED pattern
if ((x + z) % 2 === 0) {
  voxelGrid[voxelIdx] = 1; // Grass
} else {
  voxelGrid[voxelIdx] = 4; // Sand
}
```
If we see vertical stripes → axis swap confirmed  
If we see checkerboard → indexing is correct

---

### ❌ Task 1.2: Chunk Disappears When Moving
**Symptom:** Chunk blinks out when camera moves outside bounds  
**Expected:** Visible from any distance (up to max_dist=200)  
**Suspect:** 
- Shader only checks 16 iterations (line 271)
- Step size too large (16 voxels = half chunk)
- Starting position check wrong

**Test:** Add logging to shader:
```wgsl
// In computeMain, before raycast
if (global_id.x == 400u && global_id.y == 300u) {
  // Log center pixel
}
```

---

### ⚠️ Task 1.3: Camera Controls Inverted
**Symptom:** "Up and down are reversed"  
**Suspect:**
- Scene might be upside down
- Y-axis negated somewhere

**Test:** Look at the flat plane from ABOVE and BELOW - does it look the same?

---

## Priority 2: VALIDATION TESTS ✅

### ✅ Task 2.1: Verify Voxel Grid Format
**Goal:** Confirm voxelGrid indexing is correct

**Method:**
1. Log first 100 values of voxelGrid after generation
2. Check that y=0 (indices 0-1023) are all 1 (grass)
3. Check that y=1 (indices 1024-2047) are all 0 (air)

**Code to add:**
```javascript
// After debug chunk generation
const firstLayer = [];
for (let z = 0; z < 32; z++) {
  for (let x = 0; x < 32; x++) {
    const idx = z * 32 * 32 + 0 * 32 + x; // y=0
    firstLayer.push(voxelGrid[idx]);
  }
}
console.log('First layer sample:', firstLayer.slice(0, 10));
console.log('All grass?', firstLayer.every(v => v === 1));
```

---

### ✅ Task 2.2: Verify SVDAG Leaf Encoding
**Goal:** Confirm SVDAG builder creates correct structure

**Expected for flat plane:**
- Nodes: ~45 (octree height 5 for 32³ with mostly empty)
- Leaves: 1024 (32×32 grass voxels)
- All leaves should have blockId=1

**Code to add:**
```javascript
// In svdagBuilder after build
console.log('Leaf block IDs:', 
  Array.from(this.leaves).slice(0, 20),
  'Unique:', [...new Set(this.leaves)]
);
```

---

### ✅ Task 2.3: Verify Chunk Metadata
**Goal:** Confirm chunk is uploaded to GPU correctly

**Check:**
- world_offset should be [0, 128, 0]
- chunk_size should be 32
- Root index should be valid

**Code to add:**
```javascript
// In chunkedSvdagRenderer.updateChunks after building metadata
console.log('Chunk 0 metadata:', {
  offset: [metadata[0], metadata[1], metadata[2]],
  size: metadata[3],
  matRoot: metadata[4],
  matNodes: metadata[5]
});
```

---

## Priority 3: SHADER FIXES 🔧

### 🔧 Task 3.1: Increase Render Distance
**Change:**
```wgsl
// Line 271 - increase iterations
for (var i = 0; i < 64; i++) { // Was 16
```

### 🔧 Task 3.2: Smaller Step Size
**Change:**
```wgsl
// Line 266 - finer steps
let step_size = renderParams.chunk_size * 0.25; // Was 0.5
```

### 🔧 Task 3.3: Add Debug Ray Origin
**Add after line 440:**
```wgsl
// Debug: Draw ray origin chunk
let origin_chunk = getChunkIndex(ray_origin);
if (origin_chunk >= 0) {
  // Camera is inside a chunk - draw it green
  textureStore(outputTexture, coord, vec4<f32>(0.0, 1.0, 0.0, 1.0));
  return;
}
```

---

## NEXT STEPS 🎯

### Step 1: Add Logging (2 min)
Add the verification code from Tasks 2.1-2.3 to log:
- Voxel grid contents
- SVDAG leaf data
- Chunk metadata

### Step 2: Analyze Logs (1 min)
Check if blockIds are being preserved through the pipeline

### Step 3: Test Checkerboard Pattern (3 min)
Change debug chunk to alternating colors - confirms if axis swap

### Step 4: Apply Shader Fixes (2 min)
Increase iterations and reduce step size

---

## Expected Outcomes

**If logs show blockIds are correct:**
→ Problem is in shader traversal (axis swap)

**If logs show blockIds are wrong:**
→ Problem is in SVDAG builder (octree ordering)

**If checkerboard renders as vertical stripes:**
→ Confirmed axis swap in shader

**If increased iterations fix culling:**
→ Ray stepping too coarse
