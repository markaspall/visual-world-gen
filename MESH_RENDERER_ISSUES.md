# Mesh Renderer - Current Issues & Fixes

## ✅ FIXED (Reload to test):
1. **Camera looking around** - Negated mouse input for correct rotation
2. **Fog too thick** - Reduced from 0.4 to 0.15 (very subtle now)

## 🔧 IN PROGRESS:
3. **Day/night cycle jumps** - Testing smooth transitions
4. **Harsh shadows** - Need to implement proper PCF shadow sampling
5. **No visible sun/moon** - Need skybox or background sky rendering

## 📋 TODO (Major features):
6. **Water transparency** - Requires alpha blending pipeline
7. **Water reflections** - Requires Fresnel calculation + reflection sampling  
8. **Water as voxels** - BIG CHANGE: Generate 3D water volume mesh, not flat quads
   - Currently: Water = flat surface at water elevation
   - Needed: Water = voxel cubes from terrain to water level (like Minecraft)

## Technical Notes:

### Water Voxelization:
To make water render as voxels (not flat):
- In `meshBuilder.js`, change water generation loop:
  - Instead of: Create quad at `waterLevel`
  - Do: For each (x,z), create vertical column of water cubes from `terrainHeight` to `waterLevel`
  - Each cube = 6 faces (like terrain cubes)
  - Will increase triangle count significantly (96K water quads → ~500K water triangles)

### Shadow Softening:
Current shadow is placeholder (orientation-based).
Need to:
- Sample shadow map texture with PCF (4x4 or 8x8 kernel)
- Average multiple depth comparisons
- Apply bias based on surface angle

### Sun/Moon Rendering:
Options:
1. **Skybox mesh** - Render inverted sphere with sky shader
2. **Background pass** - Render fullscreen quad before terrain
3. **Fragment shader** - Detect sky pixels and apply sky+sun

Option 3 is cheapest but only works if we don't clear background.
