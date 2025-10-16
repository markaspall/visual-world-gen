# Project Structure - Client/Server Separation

**How to add server-side chunk generation while preserving existing client system**

---

## 1. Proposed Directory Structure

```
visual-world-gen/
├── public/                          # CLIENT-SIDE (existing, unchanged)
│   ├── css/
│   ├── js/
│   │   ├── main.js                  # ✅ Keep as-is (client graph editor)
│   │   ├── nodeEditor.js            # ✅ Keep as-is (Rete editor)
│   │   ├── pipeline.js              # ✅ Keep as-is (client execution)
│   │   ├── visualizer.js            # ✅ Keep as-is
│   │   ├── svdagRenderer.js         # ✅ Keep as-is (256³ single chunk)
│   │   │
│   │   ├── svdagRendererChunked.js  # 🆕 NEW (multi-chunk renderer)
│   │   ├── chunkLoader.js           # 🆕 NEW (fetch chunks from server)
│   │   ├── chunkManager.js          # 🆕 NEW (manage active chunks)
│   │   │
│   │   └── nodes/                   # ✅ Keep as-is (client WebGPU nodes)
│   │       ├── BaseNode.js
│   │       ├── PerlinNoiseNode.js
│   │       └── ... (all 28 nodes)
│   │
│   └── shaders/
│       ├── raymarcher_svdag.wgsl           # ✅ Keep (single chunk)
│       ├── raymarcher_svdag_chunked.wgsl   # 🆕 NEW (multi-chunk)
│       └── ... (other shaders unchanged)
│
├── server/                          # 🆕 NEW DIRECTORY (server-side only)
│   ├── services/
│   │   ├── graphExecutor.js         # Execute node graphs on server
│   │   ├── chunkGenerator.js        # Generate chunks on demand
│   │   ├── svdagBuilder.js          # Build SVDAG structures
│   │   └── chunkCache.js            # Cache management
│   │
│   ├── routes/
│   │   ├── chunks.js                # Chunk API endpoints
│   │   └── worlds.js                # World manifest endpoints
│   │
│   ├── lib/
│   │   ├── nodes/                   # SERVER-SIDE node implementations
│   │   │   ├── BaseNode.js          # Server version (no WebGPU)
│   │   │   ├── PerlinNoiseNode.js   # CPU/GPU-agnostic version
│   │   │   └── ... (all 28 nodes)
│   │   │
│   │   ├── chunkEncoder.js          # Binary format encoder
│   │   └── chunkDecoder.js          # Binary format decoder (for testing)
│   │
│   └── config/
│       └── nodeRegistry.js          # Register server-side nodes
│
├── shared/                          # 🆕 OPTIONAL (code used by both)
│   ├── constants.js                 # Chunk size, material IDs, etc.
│   ├── materialDefinitions.js       # Block/material data
│   └── graphSchema.js               # Node graph JSON schema
│
├── views/                           # ✅ EXISTING (EJS templates)
│   ├── index.ejs                    # ✅ Keep (graph editor UI)
│   ├── world.ejs                    # ✅ Keep (DDA renderer)
│   ├── worldMesh.ejs                # ✅ Keep (mesh renderer)
│   ├── worldSvdag.ejs               # ✅ Keep (single-chunk SVDAG)
│   └── worldSvdagChunked.ejs        # 🆕 NEW (multi-chunk infinite world)
│
├── storage/                         # ✅ EXISTING (file storage)
│   └── worlds/
│       └── world_123/
│           ├── world.json           # ✅ Existing (PNG manifest)
│           ├── heightmap.png        # ✅ Existing
│           ├── blockmap.png         # ✅ Existing
│           │
│           ├── graph.json           # 🆕 NEW (node graph definition)
│           ├── config.json          # 🆕 NEW (materials, seed, etc.)
│           └── chunks/              # 🆕 NEW (cached chunks)
│               ├── 0_0_0.svdag
│               ├── 1_0_0.svdag
│               └── ...
│
├── server.js                        # ✅ EXISTING (main server)
├── package.json                     # ✅ Update with new dependencies
└── README.md                        # ✅ Update with new features
```

---

## 2. Keeping Current System Working

### 2.1 Current Flow (Unchanged)

```
User opens http://localhost:3012/
    ↓
index.ejs (graph editor)
    ↓
Client builds graph in browser
    ↓
public/js/pipeline.js executes graph (WebGPU)
    ↓
Exports PNG to server
    ↓
View at /worlds/:worldId (DDA) or /worlds/:worldId/svdag (single chunk)
```

**Nothing changes here!** All existing routes and files work as before.

### 2.2 New Flow (Parallel System)

```
User opens http://localhost:3012/
    ↓
Saves graph (now also saves to storage/worlds/:worldId/graph.json)
    ↓
Opens /worlds/:worldId/chunked (new route)
    ↓
worldSvdagChunked.ejs loads
    ↓
svdagRendererChunked.js requests chunks from server
    ↓
GET /api/worlds/:worldId/chunks/:x/:y/:z
    ↓
server/services/chunkGenerator.js generates chunk
    ↓
Returns binary SVDAG
    ↓
Client renders infinite world
```

**New system lives alongside old one** - users can choose which renderer to use.

---

## 3. Code Sharing Strategy

### 3.1 Option A: Duplicate Node Implementations (Recommended Initially)

**Pros:**
- Clean separation
- No risk of breaking client code
- Can optimize server versions independently

**Cons:**
- Some code duplication
- Must update both if logic changes

**Example:**
```javascript
// public/js/nodes/PerlinNoiseNode.js (CLIENT - WebGPU)
export class PerlinNoiseNode extends BaseNode {
  async process(inputs, params) {
    // Uses WebGPU compute shader
    const shader = `@compute...`;
    return await this.executeShader(shader, ...);
  }
}

// server/lib/nodes/PerlinNoiseNode.js (SERVER - CPU or GPU)
export class PerlinNoiseNode {
  async process(inputs, params) {
    if (this.gpu) {
      // Use @webgpu/dawn (same shader as client)
      return await this.executeGPU(inputs, params);
    } else {
      // CPU fallback
      return await this.executeCPU(inputs, params);
    }
  }
  
  executeCPU(inputs, params) {
    // Pure JS implementation
    const result = new Float32Array(params.resolution ** 2);
    for (let y = 0; y < params.resolution; y++) {
      for (let x = 0; x < params.resolution; x++) {
        result[y * params.resolution + x] = this.perlin(x, y, params);
      }
    }
    return { output: result };
  }
}
```

### 3.2 Option B: Shared Node Base with Platform Adapters (Future)

Create abstract nodes in `shared/nodes/` with platform-specific implementations:

```javascript
// shared/nodes/PerlinNoiseNode.js (ABSTRACT)
export class PerlinNoiseNode {
  async process(inputs, params) {
    // Delegates to platform adapter
    return await this.adapter.generateNoise(params);
  }
}

// public/js/adapters/webgpuAdapter.js (CLIENT)
// server/lib/adapters/serverAdapter.js (SERVER)
```

**Defer this** until server-side is stable.

---

## 4. Migration Plan (Preserving Existing System)

### Phase 1: Setup Server Structure (Day 1)

```bash
# Create new directories (doesn't touch existing code)
mkdir -p server/services
mkdir -p server/routes
mkdir -p server/lib/nodes
mkdir -p shared

# Copy node definitions as starting point
cp -r public/js/nodes server/lib/nodes

# Existing code still works - no changes yet!
```

### Phase 2: Add New Server Routes (Day 2-3)

**File:** `server/routes/chunks.js` (NEW FILE)

```javascript
import express from 'express';
const router = express.Router();

router.get('/worlds/:worldId/chunks/:x/:y/:z', async (req, res) => {
  // New chunk endpoint
  // Existing /api/worlds/:worldId routes unchanged
});

export default router;
```

**File:** `server.js` (UPDATE - add new routes)

```javascript
// EXISTING ROUTES (keep all of these)
app.get('/', (req, res) => res.render('index'));
app.get('/worlds/:worldId', ...);
app.get('/worlds/:worldId/svdag', ...);
app.post('/api/worlds/:worldId', ...);

// NEW ROUTES (add these)
import chunkRoutes from './server/routes/chunks.js';
app.use('/api', chunkRoutes);

// NEW ROUTE for chunked viewer
app.get('/worlds/:worldId/chunked', (req, res) => {
  res.render('worldSvdagChunked', { worldId: req.params.worldId });
});
```

### Phase 3: Add New Client Files (Day 4-5)

**New files only - don't modify existing:**
- `public/js/svdagRendererChunked.js`
- `public/js/chunkLoader.js`
- `public/js/chunkManager.js`
- `public/shaders/raymarcher_svdag_chunked.wgsl`
- `views/worldSvdagChunked.ejs`

### Phase 4: Update Graph Editor to Save Graph JSON (Day 6)

**File:** `public/js/main.js` (MINIMAL UPDATE)

```javascript
// EXISTING export function (keep as-is)
async export() {
  // ... existing PNG export code ...
  
  // ADD: Also save graph JSON for server-side generation
  const graphJSON = this.editor.getGraph();
  formData.append('graph', JSON.stringify(graphJSON));
  
  // ... rest unchanged ...
}
```

**File:** `server.js` (UPDATE save endpoint)

```javascript
app.post('/api/worlds/:worldId', async (req, res) => {
  // EXISTING: Save PNGs
  // ... existing code ...
  
  // NEW: Also save graph.json
  if (req.body.graph) {
    await fs.writeFile(
      path.join(worldDir, 'graph.json'),
      req.body.graph
    );
  }
  
  // ... rest unchanged ...
});
```

---

## 5. Testing Strategy

### 5.1 Ensure Existing System Still Works

```bash
# Test current workflow
npm start
# Open http://localhost:3012/
# Build a world in graph editor
# Click "Export"
# Click "Enter 3D World" 
# Verify old renderer still works ✅

# Test SVDAG renderer
# Navigate to /worlds/world_123/svdag
# Verify single-chunk 256³ renderer works ✅
```

### 5.2 Test New System Independently

```bash
# Test new chunk endpoint
curl http://localhost:3012/api/worlds/world_123/chunks/0/0/0

# Open new chunked viewer
# Navigate to /worlds/world_123/chunked
# Verify multi-chunk renderer loads ✅
```

### 5.3 Side-by-Side Comparison

Create a comparison page:

**File:** `views/compare.ejs` (NEW)

```html
<!DOCTYPE html>
<html>
<head><title>Renderer Comparison</title></head>
<body>
  <div style="display: flex;">
    <iframe src="/worlds/<%= worldId %>/svdag" style="width: 50%; height: 100vh;"></iframe>
    <iframe src="/worlds/<%= worldId %>/chunked" style="width: 50%; height: 100vh;"></iframe>
  </div>
  <div style="position: fixed; top: 10px; left: 50%; transform: translateX(-50%);">
    <h3>Left: Single Chunk (existing) | Right: Multi-Chunk (new)</h3>
  </div>
</body>
</html>
```

Access at `/worlds/:worldId/compare` to see both renderers side-by-side.

---

## 6. Package.json Updates

```json
{
  "name": "visual-world-gen",
  "version": "2.0.0",
  "type": "module",
  "dependencies": {
    "express": "^4.18.2",
    "ejs": "^3.1.9",
    "@webgpu/dawn": "^0.0.1"  // NEW - optional, for server GPU
  },
  "devDependencies": {
    // Add if using TypeScript for shared code
    "typescript": "^5.0.0"
  },
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "node --test",
    "build:wasm": "wasm-pack build --target web"  // Optional
  }
}
```

---

## 7. Gradual Migration Path

### Week 1: Setup (No User Impact)
- Create `server/` directory structure
- Add new routes (existing routes unchanged)
- Duplicate node implementations
- **Deliverable:** Server can generate chunks (test with curl)

### Week 2: New Viewer (Optional Feature)
- Create `worldSvdagChunked.ejs`
- Add chunk loader/manager
- **Deliverable:** `/worlds/:worldId/chunked` works (existing viewers unchanged)

### Week 3: Graph Saving (Backward Compatible)
- Update export to save graph.json
- Existing PNG export still works
- **Deliverable:** Graphs saved for server-side generation

### Week 4: Testing & Polish
- Side-by-side comparison
- Performance testing
- Bug fixes
- **Deliverable:** Both systems fully functional

### Week 5+: Deprecation (Optional)
- Add banner to old viewer: "Try new infinite world renderer!"
- Eventually redirect `/worlds/:worldId/svdag` → `/worlds/:worldId/chunked`
- Remove old renderer only when confident

---

## 8. Key Principles

### ✅ DO:
- Create new files alongside existing ones
- Add new routes without modifying existing routes
- Test both systems in parallel
- Keep existing workflows functional
- Make new system opt-in initially

### ❌ DON'T:
- Modify existing client files (except minimal updates)
- Remove old routes/renderers until fully tested
- Break existing PNG export workflow
- Force users to use new system

---

## 9. File Modification Summary

### Files to Keep Untouched:
- ✅ `public/js/main.js` (except 1 line to save graph JSON)
- ✅ `public/js/nodeEditor.js`
- ✅ `public/js/pipeline.js`
- ✅ `public/js/visualizer.js`
- ✅ `public/js/svdagRenderer.js`
- ✅ All files in `public/js/nodes/`
- ✅ `public/shaders/raymarcher_svdag.wgsl`
- ✅ `views/index.ejs`, `views/world.ejs`, `views/worldSvdag.ejs`

### Files to Create (New):
- 🆕 Everything in `server/` directory
- 🆕 `public/js/svdagRendererChunked.js`
- 🆕 `public/js/chunkLoader.js`
- 🆕 `public/js/chunkManager.js`
- 🆕 `public/shaders/raymarcher_svdag_chunked.wgsl`
- 🆕 `views/worldSvdagChunked.ejs`

### Files to Update (Minimal):
- 📝 `server.js` (add new routes)
- 📝 `public/js/main.js` (save graph JSON)
- 📝 `package.json` (add dependencies)

---

## Conclusion

**Your existing client-side graph editor and renderers will continue working exactly as they do now.** The new server-side chunk generation system will be built in a separate `server/` directory and accessed through new routes (`/worlds/:worldId/chunked`).

Users can:
1. **Keep using the existing workflow** (graph editor → PNG export → single-chunk SVDAG)
2. **Try the new infinite world** (graph editor → save graph → multi-chunk SVDAG)

Both systems coexist peacefully until you're ready to deprecate the old one.

**Ready to start?** Begin with Phase 1 (directory setup) - it's completely non-destructive!
