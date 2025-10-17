# 🐛 Critical Bugs Found

## Bug #1: Only One Chunk Renders
**File:** `raymarcher_svdag_chunked.wgsl` line 299  
**Issue:** `return hit;` immediately on first chunk hit  
**Result:** Only the first chunk with geometry renders, others ignored

**Fix:** Check ALL chunks, return closest hit

---

## Bug #2: Ray Penetrates Surface (Seeing Interior Voxels)
**File:** `raymarcher_svdag_chunked.wgsl` line 158, 234  
**Issue:** Using node corner positions instead of node centers  

**Reference shader approach:**
```wgsl
// CORRECT (reference):
stack[0].pos_xyz = world_center;  // Start at CENTER
let child_center = getChildCenter(node_center, child_size, octant);
let child_min = child_center - vec3<f32>(child_half);
let child_max = child_center + vec3<f32>(child_half);
```

**Chunked shader (WRONG):**
```wgsl
// WRONG (chunked):
stack[0].pos_xyz = vec3<f32>(0.0);  // Start at CORNER
let child_pos = node_pos + vec3<f32>(cx, cy, cz) * child_size;  // Corner-based
```

**Result:** AABB tests are off by half a voxel, ray enters geometry incorrectly

---

## Fix Strategy

1. **Immediate**: Change chunked traversal to use CENTER coordinates
2. **Immediate**: Fix multi-chunk raymarch to check all chunks, return closest
3. **Test**: Should see solid flat surface across multiple chunks
