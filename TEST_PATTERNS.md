# 🧪 Test Pattern Guide

## Overview
Controlled test worlds with predictable patterns to validate rendering pipeline independently from world generation.

---

## 🎯 Available Test Patterns

### 1. **FLAT_WORLD** ✅ **RECOMMENDED START**
**What it generates:**
- Completely flat infinite plane
- Single layer at y=0 (world Y=128)  
- All grass blocks (blockId=1)
- Every chunk at Y=4 identical

**What to expect:**
- Solid green flat surface
- Perfect horizontal plane
- No shadows/edges (only top faces visible)
- No chunk boundaries visible
- Camera at [16, 135, 16] looking down should see pure green

**What it validates:**
- ✅ Basic SVDAG encoding (all same blockId)
- ✅ Shader ray-AABB intersection
- ✅ Normal calculation (all should be [0,1,0])
- ✅ Multi-chunk continuity
- ✅ Lighting on flat surfaces

**Expected SVDAG:**
- Leaves: `[1]` (single unique block type)
- Highly compressed structure
- All chunks identical

---

### 2. **CHECKERBOARD**
**What it generates:**
- Alternating grass (1) and sand (4)
- Pattern continues seamlessly across chunk boundaries
- Single layer at y=0

**What to expect:**
- Perfect alternating green/tan squares
- Pattern aligned across all chunks
- Still completely flat (no diagonal edges!)
- Chunk boundaries invisible

**What it validates:**
- ✅ SVDAG compression with 2 block types
- ✅ Deduplication working
- ✅ Cross-chunk pattern alignment
- ✅ Material system (2 colors)

**Expected SVDAG:**
- Leaves: `[1, 4]`
- More nodes than FLAT_WORLD
- Pattern should be pixel-perfect

**Known Issues:**
- If you see diagonal edges → RENDERING BUG
- If pattern breaks at chunk edges → COORDINATE BUG
- If not 50/50 grass/sand → GENERATION BUG

---

### 3. **STRIPES**
**What it generates:**
- Vertical stripes (along Z axis)
- 4 voxels wide per stripe
- Alternating grass/sand
- Continues across chunks

**What to expect:**
- Parallel vertical green/tan stripes
- Each stripe exactly 4 voxels wide
- Stripes aligned across chunks

**What it validates:**
- ✅ World coordinate system (global alignment)
- ✅ Pattern consistency
- ✅ Easier to count/verify than checkerboard

**Use case:**
- Debugging coordinate transforms
- Verifying chunk boundaries
- Testing pattern continuity

---

### 4. **STEPS** (Advanced)
**What it generates:**
- Staircase ascending in +X direction
- Each 8 voxels in X → step up by 1 voxel
- Multiple Y levels (chunks 4, 5, 6)
- All stone blocks (blockId=6)

**What to expect:**
- Visible staircase from the side
- Vertical faces between steps
- Multiple chunk Y levels populated
- 3D structure with normals in multiple directions

**What it validates:**
- ✅ Multi-layer SVDAGs
- ✅ Vertical face normals
- ✅ 3D ray marching
- ✅ Shadow/lighting on vertical surfaces
- ✅ Multi-chunk Y coordination

**Use case:**
- Testing full 3D rendering
- Validating normal calculation on all axes
- Verifying multi-height chunk loading

---

## 🎮 How to Use

### Step 1: Choose Pattern
Edit `streamChunkGenerator.js` line ~87:
```javascript
const TEST_PATTERN = 'FLAT_WORLD';  // Change this
```

Options:
- `'FLAT_WORLD'` - Start here!
- `'CHECKERBOARD'` - If FLAT_WORLD works
- `'STRIPES'` - Alternative to checkerboard
- `'STEPS'` - Advanced 3D test

### Step 2: Clear Cache
```bash
# Delete cached chunks
rm -rf storage/worlds/real_world/chunks
```

### Step 3: Run Server
```bash
npm run dev
```

### Step 4: Load World
Navigate to: `http://localhost:3012/worlds/real_world/infinite`

### Step 5: Position Camera
**For flat patterns (FLAT_WORLD, CHECKERBOARD, STRIPES):**
```javascript
// In browser console:
window.renderer.camera.position = [16, 135, 16];
window.renderer.camera.pitch = -Math.PI / 2;  // Look straight down
window.renderer.camera.yaw = 0;
```

**For STEPS:**
```javascript
// View from the side:
window.renderer.camera.position = [-20, 140, 16];
window.renderer.camera.pitch = 0;  // Look forward
window.renderer.camera.yaw = Math.PI / 2;  // Look toward +X
```

---

## ✅ Success Criteria

### FLAT_WORLD Success:
- [ ] Pure solid green color across entire view
- [ ] No black lines, gaps, or artifacts
- [ ] No diagonal edges or shadows
- [ ] Smooth scrolling with WASD (no seams)
- [ ] Looking At: shows blockId=1
- [ ] FPS: 60 (smooth performance)

### CHECKERBOARD Success:
- [ ] Perfect alternating green/tan squares
- [ ] Each square exactly 1×1 voxel
- [ ] Pattern seamless across chunk boundaries
- [ ] Still completely flat (no 3D edges!)
- [ ] 50% green, 50% tan

### STRIPES Success:
- [ ] Parallel vertical stripes
- [ ] Each stripe exactly 4 voxels wide
- [ ] Stripes align across chunks
- [ ] Clean edges between stripes

### STEPS Success:
- [ ] Visible staircase ascending
- [ ] Clean vertical faces
- [ ] Proper lighting/shadows on steps
- [ ] Steps continue across chunks

---

## 🐛 Debugging Workflow

### If FLAT_WORLD Fails:
1. **Check server logs** - Did it generate 1024 voxels?
2. **Check SVDAG** - `window.debugChunk()` - Leaves should be `[1]`
3. **Check shader** - Switch debug modes (1, F2, F3)
4. **Check normals** - All should point up (cyan in normal mode)

### If CHECKERBOARD Has Diagonal Edges:
**CRITICAL BUG!** This means:
- Voxels are at wrong positions, OR
- There are gaps between voxels, OR
- Normal calculation is wrong, OR
- Ray-AABB intersection has precision issues

**Debug steps:**
1. Switch to FLAT_WORLD first
2. If FLAT_WORLD is perfect → problem is with pattern generation
3. If FLAT_WORLD also has edges → shader/SVDAG bug

### If Pattern Breaks at Chunk Boundaries:
**Coordinate system bug!**
- Check world coordinate calculations
- Verify `cx * 32 + x` math
- Compare adjacent chunks' voxel data

---

## 📊 Expected Console Output

### FLAT_WORLD Generation:
```
🧪 TEST MODE: Generating FLAT_WORLD for chunk (0,4,0)
   ✅ Generated flat grass layer (1024 voxels)
   📊 Total solid voxels: 1024/32768

🧪 TEST MODE: Generating FLAT_WORLD for chunk (1,4,0)
   ✅ Generated flat grass layer (1024 voxels)
   📊 Total solid voxels: 1024/32768
```

### CHECKERBOARD Generation:
```
🧪 TEST MODE: Generating CHECKERBOARD for chunk (0,4,0)
   ✅ Generated checkerboard pattern
   📊 Total solid voxels: 1024/32768
```

### Empty Chunks (Y≠4):
```
🧪 TEST MODE: Generating FLAT_WORLD for chunk (0,5,0)
   📊 Total solid voxels: 0/32768
```

---

## 🎯 Recommended Testing Sequence

1. **FLAT_WORLD** - Baseline validation
   - If this fails → fundamental shader/SVDAG bug
   - If this works → rendering pipeline is sound

2. **CHECKERBOARD** - Pattern validation
   - If diagonal edges appear → **CRITICAL BUG**
   - If pattern is perfect → deduplication working

3. **STRIPES** - Coordinate validation
   - Verify world coordinate alignment
   - Easy to count and measure

4. **STEPS** - 3D validation
   - Full rendering pipeline test
   - Multi-layer chunks
   - Complex normals

---

## 🔍 Comparison to Old System

To validate against your old working renderer:
1. Generate same pattern in old system
2. Take screenshot at same camera position
3. Pixel-diff comparison
4. Should be **100% identical** for FLAT_WORLD and CHECKERBOARD

---

## 💡 Tips

- **Start simple!** FLAT_WORLD is the easiest to debug
- **One pattern at a time** - Don't switch until current one is perfect
- **Use debug modes** - F2 (depth), F3 (chunks), 4 (normals)
- **Check server logs** - Verify voxel counts match expectations
- **Freeze chunks** - Press F to stop loading new chunks while testing

---

## ⚠️ Known Issues to Watch For

### Issue: Diagonal Edges on Flat Surface
**Symptom:** Dark diagonal lines on FLAT_WORLD or CHECKERBOARD  
**Cause:** Voxel gaps, wrong positions, or normal calculation bug  
**Fix:** Debug voxel array indexing and shader AABB tests

### Issue: Pattern Breaks at Chunk Edges
**Symptom:** Checkerboard misaligned across chunks  
**Cause:** World coordinate calculation wrong  
**Fix:** Verify `cx * 32 + x` matches expected world position

### Issue: Missing Chunks
**Symptom:** Black rectangles or gaps  
**Cause:** SVDAG encoding failed or GPU upload failed  
**Fix:** Check server logs for errors, verify SVDAG not empty

---

**Current Status:** Ready to test with FLAT_WORLD! 🚀
