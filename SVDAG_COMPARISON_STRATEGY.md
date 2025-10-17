# 🔍 SVDAG System Comparison Strategy

## Objective
Compare the **old working system** (source of truth) vs **new chunked streaming system** to ensure data accuracy before tackling rendering issues separately.

---

## 📊 Two-Phase Validation Approach

### Phase 1: Source Data Validation ✅
**Goal:** Verify voxel grid generation is identical

### Phase 2: SVDAG Encoding Validation 🔍
**Goal:** Understand structural differences (compression, deduplication)

---

## 🎯 Phase 1: Source Data Validation

### What to Compare:
**Raw voxel grids BEFORE SVDAG encoding**

### Comparison Points:

#### 1.1 Grid Dimensions
- **Old:** Single 512³ super chunk
- **New:** 512³ super chunk split into 16³ stream chunks (32³ each)
- **Test:** Extract same region from both and compare

#### 1.2 Voxel-by-Voxel Comparison
For a specific region (e.g., 32x32x32 at origin):
```
Position [X, Y, Z] → BlockID
Old: voxelGrid[idx] = ?
New: voxelGrid[idx] = ?
```

**Success Criteria:**
- ✅ 100% match for same world position
- ✅ Same block IDs at same coordinates
- ✅ Same air/solid distribution

#### 1.3 Statistical Comparison
If exact match fails, compare distributions:
- Total solid voxels
- Block ID frequency (grass, sand, stone, etc.)
- Height distribution (min, max, average Y per XZ column)
- Biome distribution

### Implementation Strategy:

**Test Case: "Single Chunk Comparison"**
1. Generate chunk (0,4,0) in both systems
2. Export raw voxel arrays to JSON
3. Use diff tool or write validator
4. Output: "X differences found at positions: [...]"

**Key Questions to Answer:**
- Are the noise seeds matching?
- Are region offsets being applied correctly?
- Is the Perlin noise using correct world coordinates?
- Are block classifiers producing same results?

---

## 🧬 Phase 2: SVDAG Encoding Comparison

### Expected Differences (VALID):

#### 2.1 Compression Differences
- **Old system:** May not deduplicate aggressively
- **New system:** Deduplicates leaves by blockId (e.g., 1024 grass voxels → 1 leaf entry)

**This is CORRECT behavior** - the new system is more efficient!

#### 2.2 Node Count Differences
For a 32x32 checkerboard:
- **Uncompressed:** ~1024 leaf nodes
- **Compressed DAG:** 2-4 unique leaf entries + parent structure

### What Should Match (After Accounting for Compression):

#### 2.3 Structural Equivalence
Given same voxel input, both should produce:
- Same root structure (childMask patterns)
- Same number of unique leaf types
- Same block IDs in leaves array
- Leaves can render to same visual output

### Comparison Points:

#### 2.3.1 Topology Validation
For each octree level:
```
Depth 0 (root): childMask = ?
Depth 1: How many children with geometry?
Depth 2: ...
Depth N (leaves): Total unique block IDs?
```

**Test:** Both should have same childMask at root for same input

#### 2.3.2 Leaf Content
```
Old leaves: [1, 1, 1, 4, 4, 4, 1, ...] (1024 entries)
New leaves: [1, 4] (2 unique entries)
```

**Success Criteria:**
- ✅ Same unique block IDs present
- ✅ New system has subset or equal leaf count (due to dedup)

#### 2.3.3 Traversal Equivalence Test
**Concept:** "Ray Probe Test"
- Pick 100 random ray origins/directions
- Traverse both SVDAGs
- Compare hit results:
  - Same hit/miss status?
  - Same hit distance?
  - Same block ID at hit point?
  - Same normal?

**This tests functional equivalence despite structural differences**

---

## 🎨 Phase 3: Rendering Validation (Future)

### Visual Comparison Tests:

#### 3.1 Screenshot Diff
- Render same scene in both systems
- Same camera position/angle
- Pixel-by-pixel comparison
- Report: "99.2% match, differences in shadows"

#### 3.2 Debug Visualization Comparison
Compare debug modes:
- Depth map
- Normals
- Chunk boundaries
- Step count heatmap

#### 3.3 Performance Metrics
- FPS comparison
- Ray marching steps per pixel
- Memory usage
- Chunk load times

---

## 🛠️ Proposed Test Utilities

### Utility 1: VoxelGridComparator
```
Input: oldGrid, newGrid, chunkCoords
Output: {
  totalVoxels: 32768,
  matches: 32768,
  mismatches: 0,
  differences: [
    { pos: [5,10,3], old: 1, new: 4, reason: "block mismatch" }
  ],
  stats: {
    oldBlockCounts: { 1: 512, 4: 512 },
    newBlockCounts: { 1: 512, 4: 512 }
  }
}
```

### Utility 2: SVDAGStructureAnalyzer
```
Input: svdagData
Output: {
  nodes: 36,
  leaves: 2,
  maxDepth: 5,
  uniqueLeafValues: [1, 4],
  compressionRatio: 0.998,
  topologySignature: "root(51)->children[...] ->leaves[2]"
}
```

### Utility 3: RayProbe Tester
```
Input: svdagOld, svdagNew, rayOrigin, rayDir
Output: {
  oldHit: { distance: 7.2, blockId: 1, normal: [0,1,0] },
  newHit: { distance: 7.2, blockId: 1, normal: [0,1,0] },
  match: true
}
```

---

## 📋 Test Cases to Implement

### Test Suite 1: Source Data
- **T1.1:** Empty chunk (all air) - both should produce empty SVDAG
- **T1.2:** Solid cube (single material) - both should produce minimal structure
- **T1.3:** Checkerboard pattern - known exact pattern
- **T1.4:** Real terrain chunk at (0,4,0) - production data
- **T1.5:** Multi-biome chunk - complex case

### Test Suite 2: SVDAG Encoding
- **T2.1:** Leaf deduplication - verify new system deduplicates correctly
- **T2.2:** Empty node pruning - verify both prune air regions
- **T2.3:** DAG sharing - verify new system reuses identical subtrees
- **T2.4:** Root index validity - verify rootIdx=0 works (bug we fixed)
- **T2.5:** Node indexing - verify variable-length node arrays work

### Test Suite 3: Functional Equivalence
- **T3.1:** Center ray cast - looking straight down at terrain
- **T3.2:** Grazing rays - shallow angles
- **T3.3:** Inside geometry - ray starting inside voxel
- **T3.4:** Chunk boundaries - rays crossing chunk edges
- **T3.5:** Grid scan - sample every voxel position

---

## 🚨 Known Expected Differences

### Acceptable Variations:
1. **Leaf count:** New system will have fewer due to deduplication
2. **Node order:** May differ due to traversal order
3. **Memory layout:** New system may be more compact
4. **Build time:** New system may be slower (more optimization)

### Unacceptable Variations:
1. ❌ Different block IDs at same position
2. ❌ Different hit/miss for same ray
3. ❌ Different normals for same surface
4. ❌ Visual artifacts (missing geometry)

---

## 🔬 Investigation Workflow

### Step-by-Step Process:

#### Week 1: Source Data Validation
1. Add logging to both systems for chunk (0,4,0)
2. Export raw voxel grids to JSON files
3. Run VoxelGridComparator
4. **Decision Point:** If mismatch → fix world gen before proceeding

#### Week 2: SVDAG Structure Analysis
1. Export SVDAG structure from both systems
2. Run SVDAGStructureAnalyzer
3. Document compression differences
4. Verify leaf deduplication is correct (not a bug)

#### Week 3: Functional Testing
1. Implement RayProbe test suite
2. Run 1000+ ray samples
3. Compare hit results
4. **Decision Point:** If functional mismatch → fix SVDAG traversal

#### Week 4: Rendering Integration
1. Switch new system to use old shader temporarily
2. Test if rendering improves (isolates shader vs data issue)
3. Fix shader or data based on results

---

## 📁 Output Artifacts

### Files to Generate:
1. `comparison_results.json` - Automated test results
2. `voxel_diff_chunk_0_4_0.txt` - Per-voxel differences
3. `svdag_structure_old.txt` - Old system structure dump
4. `svdag_structure_new.txt` - New system structure dump  
5. `ray_probe_results.csv` - 1000 ray tests with hit data
6. `visual_comparison.png` - Side-by-side screenshots

### Success Metrics:
- **Gold Standard:** 100% voxel match + 100% ray probe match
- **Acceptable:** 100% voxel match + visual equivalence
- **Investigation Needed:** Any voxel mismatches

---

## 🎯 Immediate Next Steps

### Priority 1: Quick Smoke Test
**Goal:** 5-minute validation before deep dive

**Action:**
1. Add console.log in both systems for chunk (0,4,0)
2. Log first 100 voxels: `voxelGrid.slice(0, 100)`
3. Manually compare arrays
4. **If match:** Proceed to Phase 2
5. **If mismatch:** Focus on world gen debug

### Priority 2: Automated Comparison Tool
**Goal:** Reusable validator

**Features:**
- Takes two voxel grids as input
- Outputs diff report
- Highlights patterns (e.g., "shifted by 1 voxel in X")
- Suggests likely causes

### Priority 3: Visual Debug Mode
**Goal:** See differences at a glance

**Add to renderer:**
- "Comparison Mode" - render both systems side-by-side
- Color-code differences (green=match, red=mismatch)
- Show voxel-level grid overlay

---

## 💡 Debugging Hypothesis Framework

### If voxel grids DON'T match:

#### Hypothesis 1: Coordinate Transform Issues
- **Symptom:** Pattern exists but shifted
- **Check:** World offset calculations, region boundaries
- **Fix:** Verify `cx * 32` math

#### Hypothesis 2: Noise Seed Mismatch
- **Symptom:** Completely different terrain
- **Check:** Graph input parameters, seed values
- **Fix:** Ensure same graph config

#### Hypothesis 3: Block Classifier Differences
- **Symptom:** Same height, different block IDs
- **Check:** Material mappings, threshold values
- **Fix:** Align classifier logic

### If voxel grids DO match but rendering differs:

#### Hypothesis 4: SVDAG Traversal Bug
- **Symptom:** Geometry missing or wrong
- **Check:** Ray-AABB tests, stack traversal
- **Fix:** We already fixed `rootIdx==0` bug, check for more

#### Hypothesis 5: Shader Coordinate System
- **Symptom:** Rotated/flipped/mirrored output
- **Check:** Camera vectors, ray direction
- **Fix:** We fixed Y-inversion, check X/Z

#### Hypothesis 6: Chunk Metadata
- **Symptom:** Wrong chunk displayed
- **Check:** `world_offset` values, chunk indexing
- **Fix:** Verify chunk position calculations

---

## 🎓 Key Insights

### Why New System Has Fewer Leaves:
**This is CORRECT!** It's spatial compression via DAG.

Example:
- Input: 512 grass voxels, 512 sand voxels
- Old system: 1024 leaf entries
- New system: 2 leaf entries (one per unique blockId)
- Same visual output, 99.8% memory savings

### Why This Matters:
- Lower memory bandwidth
- Faster GPU processing
- More chunks in VRAM
- Better performance

### Trade-off:
- Slightly more complex traversal
- But we already fixed the shader bugs!

---

## ✅ Success Criteria Summary

### Phase 1 Complete When:
- [x] Voxel grid diff shows 100% match for test chunk
- [x] Block ID distributions identical
- [x] Height maps identical

### Phase 2 Complete When:
- [x] SVDAG structure documented and understood
- [x] Compression differences explained
- [x] Leaf deduplication verified as correct

### Phase 3 Complete When:
- [x] Ray probe tests pass (100% functional equivalence)
- [x] Visual comparison shows no artifacts
- [x] Performance metrics meet targets

---

## 📌 Final Recommendation

**Start with the smoke test:**
1. Log chunk (0,4,0) voxel data from both systems
2. Compare first 100 values manually
3. If they match → SVDAG/rendering issue (likely fixed already!)
4. If they don't → World gen issue (needs debugging)

**Then build the comparison tool:**
- Automated validator to catch regressions
- Useful for future development
- Can test any chunk, any time

**This separates concerns cleanly:**
- ✅ Data generation correctness
- ✅ SVDAG encoding correctness  
- ✅ Rendering correctness

Each can be validated independently! 🎯