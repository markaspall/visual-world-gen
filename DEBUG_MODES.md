# SVDAG Debug Modes

## How to Use
1. Press **G** to toggle the debug panel
2. Select one debug mode at a time (they're mutually exclusive)
3. Use these to diagnose rendering issues

## Debug Modes

### 🎨 Block ID Colors
**What it shows:** Unique color per block type/ID
**How it helps:** 
- Broken areas showing black = block_id is 0 (air/empty)
- Random colors in artifacts = garbage leaf indices
- Consistent color = valid block ID being read
**What to look for:** If broken areas have colors, the leaves exist but maybe geometry is wrong

### 🌳 DAG Depth (Red→Blue)
**What it shows:** Tree depth where ray hits geometry
- **Red** = Shallow (near root, depth 0-2)
- **Purple** = Mid-level (depth 3-5)  
- **Blue** = Deep (near leaves, depth 6-8)
**How it helps:**
- All blue = correctly reaching leaf nodes
- Red/purple in wrong places = traversal stopping early
- Mixed colors in artifacts = inconsistent traversal depth
**What to look for:** Broken areas should still be blue if leaves exist

### ⚡ Step Count Heatmap
**What it shows:** Number of raymarching iterations before hit
- **Blue** = Few steps (1-50) - efficient
- **Purple** = Medium steps (50-128)
- **Red** = Many steps (128-256) - slow/problem
**How it helps:**
- Red everywhere = infinite loops or bad traversal
- Sudden red patches = geometry causing excessive traversal
- Expected: blue for simple surfaces, purple for complex
**What to look for:** Broken areas with very low steps = early exit bug

## Diagnosis Strategy

### For Your Current Artifacts:

1. **Start with Block ID** (🎨)
   - Do broken areas show colors or stay black?
   - If **black** → leaves aren't being hit (traversal bug)
   - If **colored** → leaves exist but maybe wrong geometry

2. **Then DAG Depth** (🌳)
   - Are broken areas red/shallow or blue/deep?
   - If **red** → not reaching leaves (octant/child index bug)
   - If **blue** → reaching leaves but geometry wrong

3. **Finally Step Count** (⚡)
   - Do broken areas have normal or extreme step counts?
   - If **very low** (dark blue) → early exit
   - If **very high** (red) → infinite loop

## Expected Results for Valid Terrain
- **Block ID:** Consistent green hues (block type 1)
- **DAG Depth:** Mostly blue (depth 7-8 for 256³ grid)
- **Step Count:** Blue to purple (10-100 steps typical)

## Suspects Based on Visual Inspection

From your screenshot, the broken areas look like:
- Geometry holes/gaps in specific regions
- Not random noise (would suggest memory corruption)
- Patterns suggest octant traversal issue

**Most likely causes:**
1. Octant XOR ordering mismatch between builder and shader
2. Child index pointer calculation off-by-one
3. Child mask not matching builder's encoding
