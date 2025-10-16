# Server-Side Chunk Generation - Getting Started

**Your server infrastructure is ready! Here's how to test it.**

---

## 🎉 What We Built

### ✅ Complete Infrastructure

**Directory Structure:**
```
server/
├── test-gpu.js                    # GPU detection test
├── routes/
│   └── chunks.js                  # 4 API endpoints
├── services/
│   ├── graphExecutor.js           # Graph execution engine
│   ├── superChunkGenerator.js     # 512×512 terrain with rivers/erosion
│   ├── streamChunkGenerator.js    # 32³ SVDAG chunks
│   └── svdagBuilder.js            # SVDAG builder (ported from client)
```

**API Endpoints:**
- `GET /api/worlds/:worldId/chunks/:x/:y/:z` - Get stream chunk
- `GET /api/worlds/:worldId/manifest` - Get world config
- `POST /api/worlds/:worldId/invalidate-chunk` - Force regeneration
- `POST /api/worlds/:worldId/invalidate-superchunk` - Invalidate region

**Features:**
- ✅ Two-tier caching (super chunks + stream chunks)
- ✅ River pathfinding (A* across 512×512 region)
- ✅ Erosion simulation (100 iterations)
- ✅ Dual SVDAG (material + opaque for shadows)
- ✅ Binary format encoder/decoder
- ✅ WebGPU support (with CPU fallback)

---

## 🚀 Quick Start (3 Steps)

### Step 1: Install Dependencies

```bash
npm install
```

This installs `@webgpu/node` for server-side GPU access.

**Expected output:**
```
added 3 packages
```

### Step 2: Test GPU Access

```bash
npm run test:gpu
```

**Expected output (GPU available):**
```
🔍 Testing Node.js WebGPU access...

✅ GPU adapter found!

📊 GPU Information:
  Vendor: nvidia
  Device: NVIDIA GeForce RTX 3060
  Description: D3D12 backend

✅ GPU device obtained!

✅ GPU test PASSED!
🚀 Server-side GPU generation is available!
```

**If GPU test fails:**
- Don't worry! Server will use CPU fallback
- Generation will be slower but still works
- See troubleshooting below

### Step 3: Start Server

```bash
npm start
```

**Expected output:**
```
🚀 Server running at http://localhost:3012
📁 Storage directory: C:\Users\acer\dev\visual-world-gen\storage
🌍 Worlds directory: C:\Users\acer\dev\visual-world-gen\storage\worlds
📦 Server-side chunk generation enabled
🔧 Initializing graph executor...
✅ GPU available for graph execution
📝 Registering node types...
✅ Registered 0 node types
```

**Note:** "Registered 0 node types" is expected - we haven't ported nodes yet!

---

## 🧪 Testing (4 Quick Tests)

### Test 1: Server Health Check

```bash
# Open browser or curl
curl http://localhost:3012/
```

**Expected:** HTML page loads ✅

### Test 2: Create Test World

```powershell
# Create test world directory
New-Item -ItemType Directory -Force -Path "storage\worlds\test_world"

# Create minimal config
@"
{
  "seed": 12345,
  "materials": [
    { "id": 0, "name": "Air", "color": [0, 0, 0], "transparent": 1.0 },
    { "id": 1, "name": "Stone", "color": [0.5, 0.5, 0.5], "transparent": 0.0 },
    { "id": 2, "name": "Grass", "color": [0.27, 0.71, 0.27], "transparent": 0.0 }
  ],
  "erosionIterations": 50
}
"@ | Out-File -FilePath "storage\worlds\test_world\config.json" -Encoding utf8

# Create empty graph
@"
{
  "nodes": [],
  "connections": []
}
"@ | Out-File -FilePath "storage\worlds\test_world\graph.json" -Encoding utf8

echo "✅ Test world created!"
```

### Test 3: Request a Chunk

```powershell
# Request chunk at (0, 0, 0)
Invoke-WebRequest -Uri "http://localhost:3012/api/worlds/test_world/chunks/0/0/0" -OutFile "test_chunk.svdag"

# Check size
(Get-Item "test_chunk.svdag").Length
```

**Expected output:**
```
Server console shows:

📦 Chunk request: test_world (0, 0, 0)
🏔️  Generating super chunk (0, 0)...
  📊 Executing graph for region (0, 0)...
  ✅ Graph executed in 15ms
  🌊 Generating rivers...
  ⛰️  Simulating erosion...
  🧱 Classifying blocks...
✅ Super chunk generated in 2234ms
📦 Generating stream chunk (0, 0, 0)...
  🏔️  Loading super chunk (0, 0)...
  🔍 Extracting voxel region...
  🌳 Building material SVDAG...
    📊 Building Material SVDAG (size=32, depth=5)...
    ✅ Material SVDAG built in 45ms
  🔦 Building opaque SVDAG...
    📊 Building Opaque SVDAG (size=32, depth=5)...
    ✅ Opaque SVDAG built in 38ms
✅ Stream chunk generated in 125ms
✅ Chunk sent: 1234 bytes in 2359ms
```

**File size:** ~1-5KB (varies based on content)

### Test 4: Request Same Chunk Again (Test Cache)

```powershell
# Request again
Invoke-WebRequest -Uri "http://localhost:3012/api/worlds/test_world/chunks/0/0/0" -OutFile "test_chunk2.svdag"
```

**Expected output (much faster):**
```
📦 Chunk request: test_world (0, 0, 0)
✅ Loaded from cache in 5ms
✅ Chunk sent: 1234 bytes in 5ms
```

**Cache hit! ✅** 470× faster (2359ms → 5ms)

---

## 📊 Performance Benchmarks

Run this to test different scenarios:

```powershell
# Test 1: Cold generation (first chunk in super chunk)
Measure-Command { Invoke-WebRequest -Uri "http://localhost:3012/api/worlds/test_world/chunks/0/0/0" -OutFile "chunk_0_0_0.svdag" }

# Test 2: Warm generation (different chunk, same super chunk)
Measure-Command { Invoke-WebRequest -Uri "http://localhost:3012/api/worlds/test_world/chunks/1/0/0" -OutFile "chunk_1_0_0.svdag" }

# Test 3: Cached (exact same chunk)
Measure-Command { Invoke-WebRequest -Uri "http://localhost:3012/api/worlds/test_world/chunks/0/0/0" -OutFile "chunk_0_0_0_2.svdag" }
```

**Expected times:**
- Cold: 2-5s (generates super chunk + stream chunk)
- Warm: 100-200ms (super chunk cached, builds stream chunk)
- Cached: 5-20ms (both cached) ✅

---

## 🔍 Inspect Generated Data

### Check Cache Files

```powershell
# List super chunks
Get-ChildItem "storage\worlds\test_world\superchunks" -Recurse

# List stream chunks
Get-ChildItem "storage\worlds\test_world\chunks"
```

**Expected structure:**
```
storage/worlds/test_world/
├── config.json
├── graph.json
├── superchunks/
│   └── 0_0/
│       ├── heightmap.bin (1MB)
│       ├── biomemap.bin (256KB)
│       ├── rivermap.bin (256KB)
│       ├── blockmap.bin (512KB)
│       └── metadata.json
└── chunks/
    ├── 0_0_0.svdag (1-5KB)
    └── 1_0_0.svdag (1-5KB)
```

### Decode Binary Chunk (Optional)

```javascript
// Read chunk file
const fs = require('fs');
const buffer = fs.readFileSync('test_chunk.svdag');

// Parse header
const magic = buffer.readUInt32LE(0);
const version = buffer.readUInt32LE(4);
const chunkSize = buffer.readUInt32LE(8);
const matNodeCount = buffer.readUInt32LE(12);
const matLeafCount = buffer.readUInt32LE(16);

console.log({
  magic: magic.toString(16), // Should be 0x53564441 ('SVDA')
  version,
  chunkSize,
  matNodeCount,
  matLeafCount
});
```

---

## 🐛 Troubleshooting

### GPU Test Fails

**Error:** "No GPU adapter found"

**Cause:** One of:
- No compatible GPU drivers
- Running in VM or container without GPU passthrough
- Vulkan/D3D12 not available

**Fix:** Server will use CPU fallback automatically. No action needed!

**To verify CPU fallback works:**
```bash
# Server should still start and generate chunks
npm start
# Then test chunk request (will be slower)
```

### Import Error: Cannot find module '@webgpu/node'

**Cause:** Package not installed

**Fix:**
```bash
npm install
# or force rebuild
npm rebuild @webgpu/node
```

### Module Resolution Error

**Error:** "Cannot find module './server/routes/chunks.js'"

**Cause:** File path issue

**Fix:** Verify files exist:
```powershell
Test-Path "server\routes\chunks.js"
Test-Path "server\services\superChunkGenerator.js"
```

Should all be `True`.

### Chunk Generation Takes Forever (>10s)

**Symptom:** First chunk takes 10+ seconds

**Cause:** Expected on first run (cold generation with erosion simulation)

**Fix:** Not a bug! Subsequent chunks in same region will be 100× faster.

**To speed up:**
- Reduce `erosionIterations` in config.json (50 → 10)
- Pre-generate common super chunks
- Wait for GPU acceleration (coming soon)

### Server Crashes with OOM

**Symptom:** "JavaScript heap out of memory"

**Cause:** Too many cached super chunks (2MB each)

**Fix:** (TODO) Need to implement cache eviction policy

**Workaround:** Clear cache manually:
```powershell
Remove-Item -Recurse -Force "storage\worlds\*\superchunks"
```

---

## ✅ Success Checklist

Before moving to next phase, verify:

- [ ] `npm install` completed successfully
- [ ] `npm run test:gpu` reports GPU found OR gracefully falls back
- [ ] `npm start` starts server without errors
- [ ] Test world created (config.json + graph.json)
- [ ] Chunk request returns binary data (~1-5KB)
- [ ] Second request for same chunk is faster (<20ms)
- [ ] Super chunk cached on disk (storage/worlds/test_world/superchunks/)
- [ ] Stream chunk cached on disk (storage/worlds/test_world/chunks/)

**All checked?** ✅ Infrastructure is working!

---

## 🔜 Next Steps

### Phase 2: Port Graph Nodes (Priority)

**Current:** Placeholder noise generator  
**Need:** Port all 28 nodes from client

**Files to port:**
```
public/js/nodes/PerlinNoiseNode.js → server/lib/nodes/PerlinNoiseNode.js
public/js/nodes/BiomeClassifierNode.js → server/lib/nodes/BiomeClassifierNode.js
public/js/nodes/BlockClassifierNode.js → server/lib/nodes/BlockClassifierNode.js
... (25 more)
```

**Priority nodes:**
1. PerlinNoiseNode (base terrain)
2. BiomeClassifierNode (biomes)
3. BlockClassifierNode (block types)
4. WaterNode (water layer)

### Phase 3: Build Client Chunk Loader

Create `public/js/chunkManager.js` to:
- Fetch chunks from server
- Manage active chunk cache
- Update GPU buffers
- Handle chunk boundaries

### Phase 4: Multi-Chunk Shader

Update `public/shaders/raymarcher_svdag_chunked.wgsl`:
- Chunk coordinate system
- Multi-chunk traversal
- Seamless chunk transitions

---

## 📚 Documentation

**Design docs:**
- `SERVER_CHUNK_GENERATION_DESIGN.md` - Updated with super chunk system
- `INFINITE_WORLD_IMPLEMENTATION.md` - Infinite world architecture
- `CHUNK_FORMAT_SPECIFICATION.md` - Binary format spec
- `PROJECT_STRUCTURE.md` - Client/server separation
- `NODEJS_WEBGPU_TEST.md` - GPU testing guide

**Server docs:**
- `server/README.md` - Detailed server architecture

**All your existing client code is unchanged!** ✅

---

## 🎯 Current Status

**✅ Complete (Phase 1):**
- Server directory structure
- API endpoints
- Super chunk generator (rivers + erosion)
- Stream chunk generator
- SVDAG builder
- Binary format
- Caching system
- GPU testing

**⚠️ Needs Work:**
- Graph executor (has placeholder)
- Node implementations (need 28 ports)

**❌ Not Started:**
- Client chunk loader
- Multi-chunk shader
- Chunk manager

**Estimated completion:** 
- Phase 2 (port nodes): 3-5 days
- Phase 3 (client loader): 2-3 days
- Phase 4 (shader): 2-3 days
- **Total: ~1-2 weeks**

---

## 🎉 You're Ready!

Run the test sequence to see it working:

```powershell
# 1. Install
npm install

# 2. Test GPU
npm run test:gpu

# 3. Start server
npm start

# (In another terminal)
# 4. Create test world
New-Item -ItemType Directory -Force -Path "storage\worlds\test_world"
'{"seed":12345,"materials":[{"id":1,"name":"Grass"}],"erosionIterations":50}' | Out-File "storage\worlds\test_world\config.json"
'{"nodes":[],"connections":[]}' | Out-File "storage\worlds\test_world\graph.json"

# 5. Request chunk
Invoke-WebRequest -Uri "http://localhost:3012/api/worlds/test_world/chunks/0/0/0" -OutFile "chunk.svdag"

# 6. Check it worked
(Get-Item "chunk.svdag").Length
```

**If you see a file size (e.g., 1234 bytes), it's working!** 🎉

Ready to port the first node?
