# Normal Calculation Fix

## The Bug: Scattered Dots in Normals View

**Cause:** We were reusing `t0` and `t1` from the traversal loop, which get overwritten as we process children!

### Example of the Bug:

```wgsl
// In traversal loop, checking node at depth 5:
let t0 = (node_min - world_origin) * inv_ray_dir;
let t1 = (node_max - world_origin) * inv_ray_dir;

// Process children...
for each child {
  let t0 = (child_min - world_origin) * inv_ray_dir;  // OVERWRITES t0!
  let t1 = (child_max - world_origin) * inv_ray_dir;  // OVERWRITES t1!
}

// Later, when we hit a leaf:
let t_near_vec = min(t0, t1);  // ❌ Using WRONG t0/t1 from last child!
```

Result: Normal calculated from **wrong AABB**, causing random dots!

---

## The Fix: Recalculate for Leaf Node

Like the reference shader (line 436-439), we must recalculate `t0` and `t1` specifically for the leaf node:

```wgsl
// Leaf node - we hit geometry!
if (node_tag == 1u) {
  // Recalculate AABB intersection for THIS specific leaf
  let leaf_min = node_center - vec3<f32>(node_half);
  let leaf_max = node_center + vec3<f32>(node_half);
  let t0_leaf = (leaf_min - world_origin) * inv_ray_dir;  // Fresh calculation!
  let t1_leaf = (leaf_max - world_origin) * inv_ray_dir;
  let t_near_vec = min(t0_leaf, t1_leaf);
  let t_entry = max(max(t_near_vec.x, t_near_vec.y), t_near_vec.z);
  
  // Now determine which face...
}
```

---

## Additional Fix: Adaptive Epsilon

For far-away voxels, floating point precision decreases. We use an adaptive epsilon:

```wgsl
// OLD:
let epsilon = 0.001;  // Fixed epsilon

// NEW:
let epsilon = max(0.001, abs(t_entry) * 0.00001);  // Scales with distance
```

This ensures:
- Near voxels (t_entry ≈ 10): epsilon = 0.001
- Far voxels (t_entry ≈ 1000): epsilon = 0.01 (larger tolerance for reduced precision)

---

## Why the Dots Happened:

```
Processing node at depth 4:
  t0 = (node_min - origin) * inv_dir = [10.5, 12.3, 8.7]

Process child 0:
  t0 = (child0_min - origin) * inv_dir = [10.6, 12.4, 8.8]  // OVERWRITES!

Process child 7:
  t0 = (child7_min - origin) * inv_dir = [11.2, 13.1, 9.3]  // OVERWRITES AGAIN!

Hit leaf in child 2:
  t_near_vec = min(t0, t1)  // Uses child 7's t0! ❌
  t_entry = max(t_near_vec)
  if (t_entry == t_near_vec.x) → X-axis normal
  
But actually hit Y-axis face! → WRONG NORMAL → DOT ARTIFACT!
```

---

## Expected Results:

✅ **No scattered dots** (normals calculated from correct AABB)  
✅ **Smooth normal transitions** (adaptive epsilon handles precision)  
✅ **Correct face detection** (t_entry from actual leaf node)  
✅ **Consistent with reference shader** (same algorithm)  

---

## About the Circular Distortion:

The "circular" appearance at distance is **normal perspective distortion** from a wide field-of-view. It's not visible in the steps view because steps count is independent of perspective.

If you want to verify it's not a bug:
1. The steps map is clean → traversal is correct ✓
2. The depth map is smooth → distances are correct ✓
3. Only the rendered view looks "curved" → perspective effect ✓

This is the same effect you'd see in real photos with a wide-angle lens! 📸

---

**Refresh browser (Ctrl+F5)** and the normal dots should be gone! 🎯
