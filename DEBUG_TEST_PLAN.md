# 🧪 Debug Test Plan

## Current Suspicions

### ✅ FIXED
1. **Checkerboard Pattern** - Perlin noise now uses region offset
2. **Camera Underground** - Spawn height changed from y=45 to y=135

### ⚠️ NEEDS TESTING
1. **Only One Chunk Visible** - 33 chunks loaded but only current chunk renders
2. **SVDAG Traversal** - Shader may not be checking all chunks correctly
3. **Block ID Encoding** - Need to verify blockMap → voxelGrid → SVDAG → shader pipeline

---

## Test 1: Single Flat Chunk (Isolate Shader from Data Gen)

### Goal
Verify that:
- SVDAG builder works correctly for simple geometry
- Shader can render a single known chunk
- Block IDs are preserved through the pipeline

### Setup
1. **Enable debug mode:**
   ```javascript
   // In server/services/streamChunkGenerator.js line 87
   const DEBUG_FLAT_CHUNK = true;
   ```

2. **Update camera spawn:**
   ```javascript
   // In public/js/chunkedSvdagRenderer.js line 24
   position: [16, 132, 16],  // Center of chunk (0,4,0)
   ```

3. **Clear cache:**
   ```powershell
   Remove-Item -Recurse -Force "storage\worlds\real_world\chunks"
   Remove-Item -Recurse -Force "storage\worlds\real_world\superchunks"
   ```

4. **Restart server** (no --watch to avoid crashes)

### Expected Result
- Single flat grass plane at y=128 (chunk 0,4,0, local y=0)
- 32×32 grass blocks (green)
- Everything else = air

### What to Check
1. **Server logs:** Should see `🧪 DEBUG: Generating flat test chunk at (0,4,0)`
2. **Browser console:** 
   - Check `📊 X chunks, Y nodes` - should be 1 chunk with nodes
   - Press **F3** (Chunks mode) - should see single chunk highlighted
3. **Visuals:**
   - Green flat plane visible?
   - No checkerboard?
   - Correct position (world y=128)?

### If It Works
✅ SVDAG + shader pipeline is good → Problem is in data generation (graph/voxelization)

### If It Fails
❌ SVDAG or shader has issues → Fix these first before testing data gen

---

## Test 2: Multi-Chunk Debug (Once Test 1 Passes)

### Modify Debug Mode
```javascript
// Generate multiple flat chunks
if (DEBUG_FLAT_CHUNK && cy === 4) {
  // All chunks at y=4 become flat grass
  // Different colors per chunk to see boundaries
  const chunkColor = (cx + cz * 10) % 5 + 1; // blockId 1-5
  ...
}
```

### Expected
- Multiple chunks visible
- Different colors showing chunk boundaries
- No seams between chunks

---

## Test 3: Re-enable Real Terrain

Once shader + SVDAG are proven to work:

1. Set `DEBUG_FLAT_CHUNK = false`
2. Clear cache
3. Look for:
   - Continuous terrain across chunks
   - No checkerboard
   - Block variety (grass, sand, stone, snow)
   - Water at sea level

---

## Debug Controls

- **1** - Normal rendering
- **F2** - Depth/heightmap view (easier to see terrain shape)
- **F3** - Chunk boundaries (see which chunks are loaded)
- **4** - Normals (lighting debug)
- **5** - Step count heatmap (performance)
- **6** - DAG activity (shows SVDAG traversal)
- **F** - Freeze chunk loading

---

## Common Issues

### "Only current chunk visible"
**Possible causes:**
1. Shader only checking chunk at camera position
2. Root indices wrong in combined buffer
3. Chunks have empty SVDAGs (all air)

**Debug:** Press F3, move around - do chunk boundaries update?

### "Checkerboard still appears"
**Possible causes:**
1. Cache not cleared
2. SVDAG leaf encoding issue
3. Block ID sampling wrong

**Debug:** Enable flat chunk mode - does checkerboard appear on flat surface?

### "Server crashes on file change"
Node.js --watch bug. Restart without --watch:
```powershell
node server/server.js
```
