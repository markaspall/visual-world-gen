# 🔍 Debug Findings: Checkerboard Test

## Expected vs Actual

### Input (Voxel Grid)
✅ **CORRECT:** 1024 solid voxels (512 grass + 512 sand)

### Octree Build
✅ **CORRECT:** 1024 leaf nodes created

### DAG Flattening
❌ **ISSUE:** 1024 leaves → 4 leaves after flattening

---

## Root Cause: DAG Deduplication

**SVDAGs (Sparse Voxel Directed Acyclic Graphs) work by deduplicating identical subtrees.**

For a **flat checkerboard pattern**:
- All grass voxels have `blockId=1`
- All sand voxels have `blockId=4`
- Many octree nodes have **identical local patterns**

### What Happens During Flattening:

1. **Leaf deduplication by blockId:**
   - First grass voxel → creates leaf entry #0 with blockId=1
   - All other grass voxels → reuse leaf entry #0
   - First sand voxel → creates leaf entry #1 with blockId=4
   - All other sand voxels → reuse leaf entry #1

2. **Inner node deduplication by structure:**
   - Parent nodes with same child pattern get merged
   - Many positions in the checkerboard have identical local neighborhoods

### Result:
- **Input:** 1024 unique spatial positions
- **Output:** 2-4 unique leaf entries (one per blockId)
- **Deduplication count:** ~1020 nodes reused

---

## Is This a Bug? 🤔

**NO** - This is **correct DAG behavior!**

- DAGs are a **spatial compression** structure
- They deduplicate **identical geometry**, not positions
- A flat checkerboard has high redundancy → high compression

### Analogy:
Like ZIP compression:
- Input file: 1MB of repeated "AAAA" pattern
- Compressed: 10KB (99% compression)
- When decompressed: Still 1MB, but stored efficiently

---

## Why Can't We See It?

The DAG is **structurally correct**, but the **shader traversal** might have issues:

### Possible Shader Problems:

1. **Not checking all chunks**
   - Currently only traverses 16 iterations
   - May miss chunks outside camera frustum

2. **Ray stepping too coarse**
   - Step size = 16 voxels (half chunk)
   - May step over thin geometry

3. **Chunk bounds check wrong**
   - `getChunkIndex()` checks if ray origin is inside chunk
   - But doesn't check if ray **passes through** chunk

---

## What The Image Shows

Looking at your screenshot with **normals view**:
- You DO see some geometry
- It's rendering as **flat horizontal bands**
- Colors = surface normals (green/dark = Y-axis faces)

**This suggests:**
- ✅ SVDAG structure is correct
- ✅ Shader is traversing SOMETHING
- ❌ But not rendering the full checkerboard
- ❌ And culling too aggressively

---

## Next Steps

### Test #1: Verify DAG Structure
**Goal:** Confirm leaves are deduplicated correctly

**What to check in logs:**
```
🧪 DEBUG Material SVDAG (size=32, depth=5)
   Input: 1024 solid voxels { '1': 512, '4': 512 }
   Octree: 1024 leaf nodes created
   Flattened: 14 nodes, 4 leaves  ← Should see 2-4 leaves
   Deduplicated: 1020 nodes/leaves reused  ← High reuse = correct!
   Unique leaf blockIds: [1, 4]  ← One per material
```

### Test #2: Simple Solid Cube
Replace checkerboard with **solid cube of one material**:
```javascript
// All voxels = grass
for (let i = 0; i < voxelGrid.length; i++) {
  voxelGrid[i] = 1;
}
```

**Expected:** 1 leaf entry (ultimate compression!)

### Test #3: Fix Shader Traversal
- Increase ray marching iterations (64 instead of 16)
- Reduce step size (4 voxels instead of 16)
- Fix chunk intersection test to check ray path, not just origin

---

## Conclusion

**The SVDAG builder is working correctly!** 

The issue is:
1. ✅ Data generation → correct
2. ✅ SVDAG encoding → correct  
3. ❌ **Shader traversal → needs fixing**

The checkerboard test proved that deduplication works (which is good for compression), but exposed that the shader isn't rendering all visible geometry.
