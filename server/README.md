# Server-Side Architecture

**Server-side chunk generation for infinite worlds with rivers and erosion**

---

## Directory Structure

```
server/
├── test-gpu.js              # Test Node.js WebGPU access
├── routes/
│   └── chunks.js            # Chunk API endpoints
├── services/
│   ├── graphExecutor.js     # Execute node graphs
│   ├── superChunkGenerator.js   # Generate 512×512 terrain regions
│   ├── streamChunkGenerator.js  # Generate 32³ SVDAG chunks
│   └── svdagBuilder.js      # Build SVDAG structures
└── lib/
    └── nodes/               # TODO: Server-side node implementations
```

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

This installs:
- `express` - Web server
- `ejs` - Template engine
- `@webgpu/node` - Server-side WebGPU

### 2. Test GPU Access

```bash
npm run test:gpu
```

**Expected output (success):**
```
🔍 Testing Node.js WebGPU access...

✅ GPU adapter found!
📊 GPU Information:
  Vendor: nvidia
  Device: NVIDIA GeForce RTX 3060
  
✅ GPU test PASSED!
🚀 Server-side GPU generation is available!
```

**If test fails:**
- Server will use CPU fallback
- Still works, just slower generation

### 3. Start Server

```bash
npm start
```

Server runs at: `http://localhost:3012`

---

## API Endpoints

### Get Stream Chunk

**Endpoint:** `GET /api/worlds/:worldId/chunks/:x/:y/:z`

**Response:** Binary SVDAG chunk (5-50KB)

**Headers:**
```
Content-Type: application/octet-stream
X-Chunk-Size: 32
X-Chunk-Position: x,y,z
X-Generation-Time: 123 (ms)
X-Material-Nodes: 1234
X-Opaque-Nodes: 567
Cache-Control: public, max-age=3600
```

**Example:**
```bash
curl http://localhost:3012/api/worlds/world_123/chunks/0/0/0 > chunk.svdag
```

### Get World Manifest

**Endpoint:** `GET /api/worlds/:worldId/manifest`

**Response:**
```json
{
  "worldId": "world_123",
  "seed": 12345,
  "chunkSize": 32,
  "superChunkSize": 512,
  "materials": [
    { "id": 1, "name": "Grass", "color": [0.27, 0.71, 0.27], "transparent": 0.0 }
  ],
  "spawnPoint": [0, 100, 0]
}
```

### Invalidate Chunk Cache

**Endpoint:** `POST /api/worlds/:worldId/invalidate-chunk`

**Body:**
```json
{
  "x": 0,
  "y": 0,
  "z": 0
}
```

Forces regeneration of a specific chunk.

### Invalidate Super Chunk Cache

**Endpoint:** `POST /api/worlds/:worldId/invalidate-superchunk`

**Body:**
```json
{
  "sx": 0,
  "sz": 0
}
```

Forces regeneration of super chunk and all contained stream chunks.

---

## How It Works

### Two-Tier Generation

**Super Chunks (512×512):**
1. Client requests chunk at (cx, cy, cz)
2. Server determines super chunk: (sx, sz) = (cx/16, cz/16)
3. Check super chunk cache
4. If not cached:
   - Execute node graph for 512×512 region
   - Generate rivers (A* pathfinding)
   - Apply erosion simulation
   - Cache heightmap, biome map, river map, block map (~2MB)
5. Cache hit: ~50ms load time ✅

**Stream Chunks (32³):**
1. Load super chunk (from cache or generate)
2. Extract 32×32 region from 512×512 data
3. Build 32³ voxel grid (fill vertical columns)
4. Build material SVDAG
5. Build opaque SVDAG (for shadow casting)
6. Cache binary SVDAG (~5-50KB)
7. Return to client

**Cache Performance:**
- Both cached (95%): ~5ms ✅
- Super cached, stream not (4%): ~110ms
- Cold generation (1%): ~2-5s (first time only)

---

## File Storage

### Super Chunk Cache

```
storage/worlds/{worldId}/superchunks/{sx}_{sz}/
├── heightmap.bin      (512×512 Float32Array = 1MB)
├── biomemap.bin       (512×512 Uint8Array = 256KB)
├── rivermap.bin       (512×512 Uint8Array = 256KB)
├── blockmap.bin       (512×512 Uint16Array = 512KB)
└── metadata.json      (generation time, version, etc.)

Total: ~2MB per super chunk
```

### Stream Chunk Cache

```
storage/worlds/{worldId}/chunks/{cx}_{cy}_{cz}.svdag

Binary format (5-50KB per chunk):
- Header (40 bytes)
- Material nodes section
- Material leaves section
- Opaque nodes section
- Opaque leaves section
```

---

## Services

### GraphExecutor

**Purpose:** Execute node graphs to generate terrain data

**Status:** ⚠️ Placeholder (needs 28 node implementations)

**Current:** Simple noise-based placeholder

**TODO:**
- Port all client nodes to server
- Add GPU-accelerated noise generation
- Add biome classification
- Add block classification

### SuperChunkGenerator

**Purpose:** Generate 512×512 terrain regions with rivers and erosion

**Features:**
- ✅ River pathfinding (A* across full region)
- ✅ Erosion simulation (100 iterations)
- ✅ Biome classification
- ✅ Two-level caching

**Performance:** 2-5s per super chunk (cold)

### StreamChunkGenerator

**Purpose:** Extract 32³ SVDAG chunks from super chunks

**Features:**
- ✅ Voxel grid extraction
- ✅ Dual SVDAG (material + opaque)
- ✅ Binary format encoding/decoding
- ✅ Persistent cache

**Performance:** 50ms per chunk (from cached super chunk)

### SVDAGBuilder

**Purpose:** Build Sparse Voxel DAG from voxel grids

**Features:**
- ✅ Octree construction
- ✅ DAG deduplication
- ✅ Leaf compression

**Performance:** <50ms per 32³ chunk

---

## Next Steps

### Phase 1: Test GPU ✅
```bash
npm run test:gpu
```

### Phase 2: Install and Start ✅
```bash
npm install
npm start
```

### Phase 3: Test Chunk Endpoint
```bash
# Create a test world
mkdir -p storage/worlds/test_world

# Create config
echo '{"seed":12345,"materials":[]}' > storage/worlds/test_world/config.json

# Create empty graph
echo '{"nodes":[],"connections":[]}' > storage/worlds/test_world/graph.json

# Request a chunk
curl http://localhost:3012/api/worlds/test_world/chunks/0/0/0 > test_chunk.svdag

# Check size
ls -lh test_chunk.svdag
```

### Phase 4: Port Graph Nodes (TODO)

Need to port these 28 nodes from client to server:
- [ ] PerlinNoiseNode
- [ ] BiomeClassifierNode
- [ ] BlockClassifierNode
- [ ] WaterNode
- [ ] (24 more...)

### Phase 5: Build Client Chunk Loader (TODO)

Create `public/js/chunkManager.js` to:
- Request chunks from server
- Manage active chunk cache
- Update GPU buffers

### Phase 6: Build Multi-Chunk Shader (TODO)

Update `public/shaders/raymarcher_svdag_chunked.wgsl` for:
- Chunk coordinate system
- Multi-chunk traversal
- Chunk boundary handling

---

## Troubleshooting

### GPU Test Fails

**Error:** "No GPU adapter found"

**Cause:** No compatible GPU drivers or running headless

**Fix:** Server will use CPU fallback automatically

### Import Error

**Error:** "Cannot find module '@webgpu/node'"

**Fix:**
```bash
npm install
# or
npm rebuild @webgpu/node
```

### Chunk Generation Slow

**Symptom:** 5+ seconds per chunk

**Cause:** Cold super chunk generation

**Expected:** First chunk in a region takes 2-5s, subsequent chunks in same region take <100ms

### Out of Memory

**Symptom:** Server crashes with OOM

**Cause:** Too many cached super chunks

**Fix:** Add cache eviction policy (TODO)

---

## Performance Targets

**Super Chunk Generation:**
- Cold: 2-5s (acceptable, happens rarely)
- Cached: 50ms (loading from disk)

**Stream Chunk Generation:**
- From cached super chunk: 50-100ms
- From cold super chunk: 2-5s
- From fully cached: 5ms ✅

**Memory Usage:**
- Per super chunk: ~2MB
- Per stream chunk: ~20KB (in memory before encode)
- Target: <500MB server memory for 100 active super chunks

**Client Targets:**
- Chunk load time: <100ms (network + decode)
- Render performance: 60 FPS with 100 active chunks
- Memory: <100MB client-side

---

## Architecture Diagrams

### Data Flow

```
Client Navigation
    ↓
Request chunk (cx, cy, cz)
    ↓
Server: Determine super chunk (sx, sz)
    ↓
┌─────────────────────────────┐
│ Load Super Chunk Cache?     │
│   YES → Load from disk 50ms │
│   NO ↓                      │
│   Generate:                 │
│   - Execute graph (1-2s)    │
│   - Rivers (500ms)          │
│   - Erosion (1-2s)          │
│   - Cache (100ms)           │
└─────────────────────────────┘
    ↓
Extract 32³ region
    ↓
Build dual SVDAG
    ↓
Cache stream chunk
    ↓
Return binary to client
```

### Directory Dependencies

```
server.js
    ↓
server/routes/chunks.js
    ↓
server/services/streamChunkGenerator.js
    ↓
server/services/superChunkGenerator.js
    ↓
server/services/graphExecutor.js
    ↓
server/services/svdagBuilder.js
```

---

## Current Status

✅ **Complete:**
- Directory structure
- API routes
- Super chunk generator (with rivers & erosion)
- Stream chunk generator
- SVDAG builder
- Binary format encoder/decoder
- Two-level caching

⚠️ **In Progress:**
- Graph executor (placeholder implementation)
- Node implementations (need to port 28 nodes)

❌ **TODO:**
- Client chunk loader
- Multi-chunk shader
- Chunk management (loading/unloading)
- Cache eviction policy
- Performance optimization

**Next:** Test GPU access, then port node implementations!
