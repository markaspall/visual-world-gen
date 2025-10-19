/**
 * Chunked SVDAG Renderer
 * Renders infinite world using multi-chunk SVDAG raymarching
 */

import { ChunkManager } from './chunkManager.js';
import { VisibilityScanner } from './visibilityScanner.js';

export class ChunkedSvdagRenderer {
  constructor(canvas, worldId) {
    this.canvas = canvas;
    this.worldId = worldId;
    
    // WebGPU
    this.device = null;
    this.context = null;
    this.presentationFormat = null;
    
    // Chunk management
    this.chunkManager = null;
    this.visibilityScanner = null;
    
    // Frame counter for chunk update throttling
    this.frameCount = 0;
    this.chunkUpdateInterval = 5;  // Update chunks every 5 frames (~83ms at 60fps)
    
    // Scan result caching
    this.lastScanResults = null;
    this.lastScanPosition = [0, 0, 0];
    this.scanReuseDistance = 32;  // Reuse scan if camera moved less than this
    this.lastScanFrame = 0;
    
    // Request-on-miss system
    this.chunkRequestBuffer = null;
    this.chunkRequestStaging = null;
    this.viewDistanceChunks = 16;
    this.gridSize = this.viewDistanceChunks * 2 + 1;  // 33
    this.requestBufferSize = this.gridSize ** 3;  // 35,937
    this.isProcessingRequests = false;  // Prevent concurrent reads
    
    // Logging throttle
    this.lastRequestCount = 0;
    this.lastLogTime = 0;
    this.stableFrames = 0;
    
    // Camera (DEBUG: Center of test chunk 0,4,0 at world [0-32, 128-160, 0-32])
    this.camera = {
      position: [16, 135, 16],  // Center of chunk (0,4,0)
      yaw: 0,
      pitch: -0.5,  // Look down a bit to see the plane
      fov: Math.PI / 3,
      moveSpeed: 15.0,
      lookSpeed: 0.002
    };
    
    // Rendering
    this.outputTexture = null;
    this.pipeline = null;
    this.bindGroup = null;
    
    // Debug
    this.debugMode = 0; // 0=normal, 1=depth, 4=normals, 5=steps, 6=chunks, 7=heatmap, 8=dag, 9=freeze
    this.centerRayHit = null; // What the center of screen is looking at
    this.freezeChunks = false;
    
    // Chunk stability tracking
    this.chunkSnapshots = new Map(); // Track chunk positions over time
    this.snapshotInterval = 10; // Take snapshot every 10 frames (~6 per second at 60fps)
    this.lastSnapshotFrame = 0;
    
    // Stats
    this.lastFrameTime = performance.now();
    this.time = 0;
    this.frameCount = 0;
    this.lastUploadCount = 0;  // Track when chunk count changes
    this.uploadedChunkCount = 0;  // Track how many chunks are on GPU
    this.cacheHitsThisFrame = 0;   // Track cache hits this frame
    this.totalCacheHits = 0;        // Track total cache hits
    this.evictedThisFrame = 0;      // Track evictions this frame
    this.totalEvicted = 0;          // Track total evictions
    this.adaptiveMaxDistance = 2048;  // Adaptive render distance
    this.adaptiveMaxChunkSteps = 128; // Adaptive chunk steps
    
    // Meta-SVDAG Spatial Skip (Stage 7b) - CONFIGURABLE!
    this.metaChunkSize = { x: 4, y: 4, z: 4 };  // Each meta-chunk = 4x4x4 chunks (TUNABLE!)
    this.metaGridSize = { x: 16, y: 16, z: 16 };  // Total meta-grid size
    this.metaGrid = new Uint32Array(16 * 16 * 16);  // 4096 meta-chunks (16KB, must match shader u32!)
    this.metaGridBuffer = null;
    this.metaGridReadbackDone = false;  // Flag for one-time GPU readback test
    this.metaSkipEnabled = true;  // Toggle for meta-SVDAG spatial skip
    
    this.gpuMemoryUsed = {
      metadata: 0,
      nodes: 0,
      leaves: 0,
      hashTable: 32768,  // 8192 * 4 bytes
      metaGrid: 16384    // 16*16*16 * 4 bytes (u32)
    };
    this.fps = 60;
    this.fpsFrames = [];
    
    // Input
    this.keys = {};
    
    // GPU buffers
    this.cameraBuffer = null;
    this.renderParamsBuffer = null;
    this.chunkMetadataBuffer = null;
    this.svdagNodesBuffer = null;
    this.svdagLeavesBuffer = null;
    this.materialsBuffer = null;
    this.timeParamsBuffer = null;
    
    // Timing
    this.time = 0;
    this.lastFrameTime = performance.now();
    
    // Materials (default set)
    this.materials = [
      { colorR: 0, colorG: 0, colorB: 0, transparent: 1, emissive: 0, reflective: 0 }, // Air
      { colorR: 0.45, colorG: 0.71, colorB: 0.27, transparent: 0, emissive: 0, reflective: 0 }, // Grass
      { colorR: 0.6, colorG: 0.4, colorB: 0.2, transparent: 0, emissive: 0, reflective: 0 }, // Dirt
      { colorR: 0.5, colorG: 0.5, colorB: 0.5, transparent: 0, emissive: 0, reflective: 0 }, // Stone
      { colorR: 0.9, colorG: 0.85, colorB: 0.6, transparent: 0, emissive: 0, reflective: 0 }, // Sand
      { colorR: 0.95, colorG: 0.95, colorB: 1.0, transparent: 0, emissive: 0, reflective: 0.3 }, // Snow
      { colorR: 0.2, colorG: 0.4, colorB: 0.8, transparent: 0.8, emissive: 0, reflective: 0.2 }, // Water
      { colorR: 0.13, colorG: 0.54, colorB: 0.13, transparent: 0, emissive: 0, reflective: 0 } // Tree
    ];
  }

  async initialize() {
    console.log('🎮 Initializing chunked SVDAG renderer...');
    
    // Initialize WebGPU
    if (!navigator.gpu) {
      throw new Error('WebGPU not supported in this browser');
    }
    
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Failed to get GPU adapter');
    }
    
    this.device = await adapter.requestDevice();
    
    // Setup canvas context
    this.context = this.canvas.getContext('webgpu');
    this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.presentationFormat
    });
    
    // Create chunk manager
    this.chunkManager = new ChunkManager(this.worldId, this.device);
    
    // OLD SYSTEM DISABLED - Using request-on-miss instead (Stages 1-2 complete)
    // this.visibilityScanner = new VisibilityScanner(this.device, this.camera, 32);
    // await this.visibilityScanner.init();
    console.log('⚠️ Visibility scanner DISABLED - using request-on-miss only');
    
    // Load shader
    const shaderCode = await fetch('/shaders/raymarcher_svdag_chunked.wgsl').then(r => r.text());
    
    // Create intermediate RGBA texture for compute shader output
    this.computeTexture = this.device.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    });
    
    // Create buffers
    this.cameraBuffer = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    
    this.renderParamsBuffer = this.device.createBuffer({
      size: 32,  // 8 fields * 4 bytes (time, max_chunks, chunk_size, max_depth, debug_mode, max_distance, max_chunk_steps, padding)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    
    this.timeParamsBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    
    // Create materials buffer
    const materialsData = new Float32Array(this.materials.length * 8);
    for (let i = 0; i < this.materials.length; i++) {
      const m = this.materials[i];
      materialsData[i * 8 + 0] = m.colorR;
      materialsData[i * 8 + 1] = m.colorG;
      materialsData[i * 8 + 2] = m.colorB;
      materialsData[i * 8 + 3] = m.transparent;
      materialsData[i * 8 + 4] = m.emissive;
      materialsData[i * 8 + 5] = m.reflective;
    }
    
    this.materialsBuffer = this.device.createBuffer({
      size: materialsData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(this.materialsBuffer, 0, materialsData);
    
    // Create request buffer (GPU read/write)
    this.chunkRequestBuffer = this.device.createBuffer({
      label: 'Chunk Request Buffer',
      size: this.requestBufferSize * 4,  // 35,937 * 4 bytes = 144KB
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    });
    
    // Create staging buffer (CPU read)
    this.chunkRequestStaging = this.device.createBuffer({
      label: 'Chunk Request Staging',
      size: this.requestBufferSize * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });
    
    // Initialize to zero
    const clearData = new Uint32Array(this.requestBufferSize);
    this.device.queue.writeBuffer(this.chunkRequestBuffer, 0, clearData);
    
    console.log(`📊 Request buffer initialized: ${this.requestBufferSize} slots (${(this.requestBufferSize * 4 / 1024).toFixed(1)}KB)`);
    
    // Create placeholder buffers (will be updated when chunks load)
    this.chunkMetadataBuffer = this.device.createBuffer({
      size: 1024 * 192, // 600 chunks max (32 bytes per chunk * 600 = 19.2KB)
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    
    this.svdagNodesBuffer = this.device.createBuffer({
      size: 1024 * 1024 * 4, // 4MB for all chunks' nodes
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    
    this.svdagLeavesBuffer = this.device.createBuffer({
      size: 1024 * 256, // 256KB for leaves
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    
    this.chunkHashTableBuffer = this.device.createBuffer({
      size: 8192 * 4, // 32KB for hash table (8192 u32 entries)
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    
    // Meta-grid buffer (Stage 7b)
    this.metaGridBuffer = this.device.createBuffer({
      size: 16 * 16 * 16 * 4, // 16KB for meta-grid (16x16x16 u32 entries)
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true  // Initialize to zeros!
    });
    // Zero out the buffer
    new Uint32Array(this.metaGridBuffer.getMappedRange()).fill(0);
    this.metaGridBuffer.unmap();
    console.log('✅ Meta-grid buffer initialized to zeros');
    
    // Create pipeline
    const shaderModule = this.device.createShaderModule({ code: shaderCode });
    
    this.pipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: shaderModule, entryPoint: 'main' }
    });
    
    // Create bind group (with compute texture)
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer } },
        { binding: 1, resource: { buffer: this.renderParamsBuffer } },
        { binding: 2, resource: { buffer: this.chunkMetadataBuffer } },
        { binding: 3, resource: { buffer: this.svdagNodesBuffer } },
        { binding: 4, resource: { buffer: this.svdagLeavesBuffer } },
        { binding: 5, resource: this.computeTexture.createView() },
        { binding: 6, resource: { buffer: this.materialsBuffer } },
        { binding: 7, resource: { buffer: this.chunkRequestBuffer } },
        { binding: 8, resource: { buffer: this.chunkHashTableBuffer } },
        { binding: 9, resource: { buffer: this.metaGridBuffer } }  // Stage 7b: Meta-grid
      ]
    });
    
    // Create simple blit pipeline (copy rgba to canvas bgra)
    const blitShader = this.device.createShaderModule({
      code: `
        @vertex
        fn vs_main(@builtin(vertex_index) idx: u32) -> @builtin(position) vec4<f32> {
          var pos = array<vec2<f32>, 6>(
            vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
            vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0)
          );
          return vec4<f32>(pos[idx], 0.0, 1.0);
        }
        
        @group(0) @binding(0) var srcTexture: texture_2d<f32>;
        @group(0) @binding(1) var srcSampler: sampler;
        
        @fragment
        fn fs_main(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
          let uv = pos.xy / vec2<f32>(textureDimensions(srcTexture));
          return textureSample(srcTexture, srcSampler, uv);
        }
      `
    });
    
    this.blitPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: blitShader, entryPoint: 'vs_main' },
      fragment: {
        module: blitShader,
        entryPoint: 'fs_main',
        targets: [{ format: this.presentationFormat }]
      }
    });
    
    this.blitSampler = this.device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest'
    });
    
    // Setup input handlers
    this.setupInput();
    
    console.log('✅ Renderer initialized - Press 0-9 for debug modes (avoid 2,3)');
    
    // Create debug HUD
    this.createDebugHUD();
    
    // Expose debug functions globally
    window.debugRenderer = {
      inspectChunk: (cx, cy, cz) => {
        const key = `${cx},${cy},${cz}`;
        const chunk = this.chunkManager.chunks.get(key);
        if (!chunk) {
          console.error(`❌ Chunk (${cx},${cy},${cz}) not loaded`);
          return;
        }
        
        console.log(`🔍 Inspecting chunk (${cx},${cy},${cz}):`);
        console.log(`  World bounds: X:${cx*32}..${(cx+1)*32-1}, Y:${cy*32}..${(cy+1)*32-1}, Z:${cz*32}..${(cz+1)*32-1}`);
        console.log(`  Material SVDAG: ${chunk.materialSVDAG.nodes.length} nodes, ${chunk.materialSVDAG.leaves.length} leaves, root=${chunk.materialSVDAG.rootIdx}`);
        console.log(`  Opaque SVDAG: ${chunk.opaqueSVDAG.nodes.length} nodes, ${chunk.opaqueSVDAG.leaves.length} leaves, root=${chunk.opaqueSVDAG.rootIdx}`);
        console.log(`  First 10 material leaves:`, Array.from(chunk.materialSVDAG.leaves).slice(0, 10));
        console.log(`  First 10 opaque leaves:`, Array.from(chunk.opaqueSVDAG.leaves).slice(0, 10));
        
        return chunk;
      },
      listChunks: () => {
        const chunks = this.chunkManager.getLoadedChunks();
        console.log(`📦 ${chunks.length} chunks loaded:`);
        chunks.slice(0, 20).forEach(c => {
          console.log(`  (${c.cx},${c.cy},${c.cz}) - Mat:${c.materialSVDAG.nodes.length}n/${c.materialSVDAG.leaves.length}l, Opq:${c.opaqueSVDAG.nodes.length}n/${c.opaqueSVDAG.leaves.length}l`);
        });
        if (chunks.length > 20) console.log(`  ... and ${chunks.length - 20} more`);
      },
      renderer: this
    };
    console.log('💡 Debug commands: window.debugRenderer.inspectChunk(cx,cy,cz), window.debugRenderer.listChunks()');
  }
  
  createDebugHUD() {
    // Create HUD container
    const hud = document.createElement('div');
    hud.id = 'debug-hud';
    hud.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: #0f0;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      padding: 10px;
      border: 1px solid #0f0;
      border-radius: 4px;
      pointer-events: none;
      user-select: none;
      line-height: 1.4;
      z-index: 1000;
    `;
    document.body.appendChild(hud);
    this.debugHUD = hud;
    
    // Create controls panel
    const controls = document.createElement('div');
    controls.id = 'debug-controls';
    controls.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: #fff;
      font-family: Arial, sans-serif;
      font-size: 11px;
      padding: 10px;
      border: 1px solid #666;
      border-radius: 4px;
      pointer-events: none;
      user-select: none;
      line-height: 1.6;
      z-index: 1000;
    `;
    controls.innerHTML = `
      <div style="color: #0ff; font-weight: bold; margin-bottom: 5px;">🎮 Controls</div>
      <div><b>WASD</b> - Move</div>
      <div><b>Space/Shift</b> - Up/Down</div>
      <div><b>Mouse</b> - Look (click to lock)</div>
      <div style="margin-top: 8px; color: #0ff; font-weight: bold;">🎨 Debug Modes</div>
      <div><b>0</b> - Normal</div>
      <div><b>1</b> - Depth</div>
      <div><b>4</b> - Normals</div>
      <div><b>5</b> - Steps (heatmap)</div>
      <div><b>6</b> - Chunks</div>
      <div><b>7</b> - Memory</div>
      <div><b>8</b> - DAG</div>
      <div><b>9</b> - Freeze chunks</div>
      <div><b>-</b> - Skip efficiency</div>
      <div style="margin-top: 8px; color: #0ff; font-weight: bold;">⚡ Optimizations</div>
      <div><b>M</b> - Toggle Meta-Skip</div>
      <div style="margin-top: 8px; color: #0ff; font-weight: bold;">🔍 Debug</div>
      <div><b>L</b> - Dump buffer state</div>
    `;
    document.body.appendChild(controls);
  }
  
  showFreezeWarning() {
    let warning = document.getElementById('freeze-warning');
    if (!warning) {
      warning = document.createElement('div');
      warning.id = 'freeze-warning';
      warning.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(255, 165, 0, 0.95);
        color: #000;
        font-family: Arial, sans-serif;
        font-size: 24px;
        font-weight: bold;
        padding: 20px 40px;
        border: 3px solid #ff8800;
        border-radius: 10px;
        pointer-events: none;
        user-select: none;
        z-index: 10000;
        box-shadow: 0 0 20px rgba(255, 165, 0, 0.8);
      `;
      warning.textContent = '🧊 CHUNKS FROZEN - Press 9 to Unfreeze';
      document.body.appendChild(warning);
    }
    warning.style.display = 'block';
  }
  
  hideFreezeWarning() {
    const warning = document.getElementById('freeze-warning');
    if (warning) {
      warning.style.display = 'none';
    }
  }
  
  updateDebugHUD() {
    if (!this.debugHUD) return;
    
    const chunks = this.chunkManager.chunks.size;
    const softLimit = Math.floor(this.chunkManager.maxCachedChunks * 0.6);  // 60% soft limit
    const pressure = (chunks / softLimit * 100).toFixed(1);  // Show pressure relative to soft limit
    const threshold = this.chunkManager.getCurrentEvictionThreshold();
    const pos = this.camera.position;
    const camChunk = this.chunkManager.worldToChunk(pos[0], pos[1], pos[2]);
    
    const debugModeNames = ['Normal', 'Depth', '??', '??', 'Normals', 'Chunk Steps', 'Chunks', 'Memory', 'DAG', 'Freeze', 'Skip Efficiency'];
    const modeName = debugModeNames[this.debugMode] || 'Unknown';
    
    // Find min/max loaded chunks to show range
    const loadedChunks = this.chunkManager.getLoadedChunks();
    let chunkRange = 'none';
    if (loadedChunks.length > 0) {
      const minCx = Math.min(...loadedChunks.map(c => c.cx));
      const maxCx = Math.max(...loadedChunks.map(c => c.cx));
      const minCy = Math.min(...loadedChunks.map(c => c.cy));
      const maxCy = Math.max(...loadedChunks.map(c => c.cy));
      const minCz = Math.min(...loadedChunks.map(c => c.cz));
      const maxCz = Math.max(...loadedChunks.map(c => c.cz));
      chunkRange = `X:${minCx}..${maxCx} Y:${minCy}..${maxCy} Z:${minCz}..${maxCz}`;
    }
    
    // Check if camera is inside loaded chunk range
    const inRange = loadedChunks.some(c => c.cx === camChunk.cx && c.cy === camChunk.cy && c.cz === camChunk.cz);
    const rangeColor = inRange ? '#0f0' : '#f00';
    
    // Calculate GPU memory
    const totalGPU = this.gpuMemoryUsed.metadata + this.gpuMemoryUsed.nodes + 
                     this.gpuMemoryUsed.leaves + this.gpuMemoryUsed.hashTable;
    const gpuMB = (totalGPU / 1024 / 1024).toFixed(2);
    const avgPerChunk = chunks > 0 ? (totalGPU / chunks / 1024).toFixed(1) : '0';
    
    this.debugHUD.innerHTML = `
      <div style="color: #0ff; font-weight: bold; margin-bottom: 5px;">📊 Debug Info</div>
      <div><b>FPS:</b> ${this.fps.toFixed(1)}</div>
      <div><b>Frame:</b> ${this.frameCount}</div>
      <div><b>Mode:</b> ${modeName} (${this.debugMode})</div>
      <div style="margin-top: 6px; color: #ff0; font-weight: bold;">📦 Chunks</div>
      <div><b>Loaded:</b> ${chunks}/${softLimit} (max ${this.chunkManager.maxCachedChunks})</div>
      <div><b>On GPU:</b> ${this.uploadedChunkCount}</div>
      <div><b>Pressure:</b> <span style="color:${pressure > 100 ? '#f00' : pressure > 80 ? '#f80' : '#0f0'}">${pressure}%</span></div>
      <div><b>Eviction:</b> ${pressure > 133 ? '<span style="color:#f80">distance+LRU</span>' : pressure > 100 ? 'distance' : 'none'}</div>
      <div><b>Evicted (frame):</b> <span style="color:${this.evictedThisFrame > 0 ? '#f80' : '#0f0'}">${this.evictedThisFrame}</span></div>
      <div><b>Evicted (total):</b> ${this.totalEvicted}</div>
      <div><b>Chunk misses:</b> <span style="color:${this.cacheHitsThisFrame > 0 ? '#f80' : '#0f0'}">${this.cacheHitsThisFrame}</span> / ${this.totalCacheHits}</div>
      <div><b>Range:</b> ${chunkRange}</div>
      <div><b>Max distance:</b> <span style="color:${this.adaptiveMaxDistance < 2048 ? '#f80' : '#0f0'}">${this.adaptiveMaxDistance || 2048}</span></div>
      <div><b>Max chunk steps:</b> <span style="color:${this.adaptiveMaxChunkSteps < 128 ? '#f80' : '#0f0'}">${this.adaptiveMaxChunkSteps || 128}</span></div>
      <div><b>Frozen:</b> ${this.freezeChunks ? '<span style="color:#f80">YES</span>' : 'no'}</div>
      <div style="margin-top: 6px; color: #0f0; font-weight: bold;">💾 GPU Memory</div>
      <div><b>Total:</b> ${gpuMB} MB</div>
      <div><b>Per chunk:</b> ${avgPerChunk} KB</div>
      <div style="font-size: 10px; color: #aaa;">Metadata: ${(this.gpuMemoryUsed.metadata/1024).toFixed(1)}KB | Nodes: ${(this.gpuMemoryUsed.nodes/1024).toFixed(1)}KB</div>
      <div style="font-size: 10px; color: #aaa;">Leaves: ${(this.gpuMemoryUsed.leaves/1024).toFixed(1)}KB | Hash: ${(this.gpuMemoryUsed.hashTable/1024).toFixed(1)}KB</div>
      <div style="margin-top: 6px; color: #f80; font-weight: bold;">🗺️ Meta-SVDAG Skip</div>
      <div><b>Status:</b> <span style="color:${this.metaSkipEnabled ? '#0f0' : '#f00'}">${this.metaSkipEnabled ? 'ON ✅' : 'OFF ❌'}</span> <span style="color:#888">(M key)</span></div>
      <div><b>Meta chunk:</b> ${this.metaChunkSize.x}x${this.metaChunkSize.y}x${this.metaChunkSize.z} (${this.metaChunkSize.x * this.metaChunkSize.y * this.metaChunkSize.z} chunks)</div>
      <div><b>Meta-chunks:</b> ${Array.from(this.metaGrid).filter(v => v === 1).length}/${this.metaGrid.length} populated</div>
      <div style="margin-top: 6px; color: #0ff; font-weight: bold;">♻️ SVDAG Dedup</div>
      <div><b>Unique:</b> ${this.chunkManager.svdagPool.size}/${chunks}</div>
      <div><b>Savings:</b> <span style="color:#0f0">${chunks > 0 ? ((1 - this.chunkManager.svdagPool.size / chunks) * 100).toFixed(1) : 0}%</span></div>
      <div><b>Memory saved:</b> ${((chunks - this.chunkManager.svdagPool.size) * 0.05).toFixed(1)} MB</div>
      <div style="margin-top: 6px; color: #f0f; font-weight: bold;">📍 Position</div>
      <div><b>World:</b> ${pos[0].toFixed(1)}, ${pos[1].toFixed(1)}, ${pos[2].toFixed(1)}</div>
      <div><b>Chunk:</b> <span style="color:${rangeColor}">(${camChunk.cx}, ${camChunk.cy}, ${camChunk.cz})</span></div>
      <div><b>In Range:</b> <span style="color:${rangeColor}">${inRange ? 'YES' : 'NO'}</span></div>
      <div><b>Yaw:</b> ${(this.camera.yaw * 180 / Math.PI).toFixed(1)}°</div>
      <div><b>Pitch:</b> ${(this.camera.pitch * 180 / Math.PI).toFixed(1)}°</div>
    `;
  }

  setupInput() {
    // Keyboard input
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      
      // Debug mode cycling (avoid keys 2 and 3)
      switch (e.code) {
        case 'Digit9':
          this.debugMode = 9;
          console.log('🎨 Debug: FREEZE CHUNKS');
          break;
        case 'Minus':
        case 'NumpadSubtract':
          this.debugMode = 10;
          console.log('🎨 Debug: META-SKIP EFFICIENCY (green=many skips, red=no skips)');
          break;
        case 'KeyM':
          this.metaSkipEnabled = !this.metaSkipEnabled;
          console.log(`🗺️ Meta-SVDAG Skip: ${this.metaSkipEnabled ? 'ENABLED ✅' : 'DISABLED ❌'} - See HUD for stats!`);
          break;
        case 'Digit4':
          this.debugMode = 4; // Normals
          console.log('🎨 Debug: NORMALS');
          break;
        case 'Digit5':
          this.debugMode = 5; // Chunk steps heatmap
          console.log('🎨 Debug: CHUNK STEPS HEATMAP (how many chunks ray traversed)');
          break;
        case 'Digit6':
          this.debugMode = 6; // Chunk boundaries
          console.log('🎨 Debug: CHUNK BOUNDARIES');
          break;
        case 'Digit7':
          this.debugMode = 7; // Memory heatmap
          console.log('🎨 Debug: MEMORY HEATMAP');
          break;
        case 'Digit8':
          this.debugMode = 8; // DAG structure
          console.log('🎨 Debug: DAG STRUCTURE');
          break;
        case 'Digit0':
          this.debugMode = 0; // Normal rendering
          console.log('🎨 Debug: NORMAL');
          break;
        case 'Digit1':
          this.debugMode = 1; // Depth
          console.log('🎨 Debug: DEPTH');
          break;
        case 'KeyL':
          this.dumpBufferState();
          break;
        case 'Escape':
          document.exitPointerLock();
          break;
      }
      if (e.code === 'Digit9') {
        this.freezeChunks = !this.freezeChunks;
        if (this.freezeChunks) {
          console.log('🧊 Freeze chunks: ON - Camera can move but chunks stay frozen');
          console.log('⚠️ WARNING: Moving camera while frozen WILL cause visual corruption!');
          this.showFreezeWarning();
        } else {
          console.log('✅ Freeze chunks: OFF - Normal operation resumed');
          this.hideFreezeWarning();
        }
      }
      if (e.code === 'Digit0') {
        this.debugMode = 0; // Normal rendering
        console.log('🎨 Debug: NORMAL');
      }
      
      // L - Dump buffer state
      if (e.code === 'KeyL') {
        this.dumpBufferState();
      }
      
      // Escape
      if (e.code === 'Escape') {
        document.exitPointerLock();
      }
    });
    
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
    
    // Mouse input
    this.canvas.addEventListener('click', () => {
      this.canvas.requestPointerLock();
    });
    
    this.pointerLocked = false;
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
    
    let mouseMovement = [0, 0];
    document.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        mouseMovement[0] += e.movementX;
        mouseMovement[1] += e.movementY;
      }
    });
    
    // Apply mouse movement to camera
    setInterval(() => {
      if (mouseMovement[0] !== 0 || mouseMovement[1] !== 0) {
        this.camera.yaw += mouseMovement[0] * this.camera.lookSpeed;
        this.camera.pitch -= mouseMovement[1] * this.camera.lookSpeed;
        this.camera.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.camera.pitch));
        mouseMovement = [0, 0];
      }
    }, 16);
  }

  updateMovement(dt) {
    if (!this.pointerLocked) return;
    
    const forward = [
      Math.sin(this.camera.yaw) * Math.cos(this.camera.pitch),
      Math.sin(this.camera.pitch),
      Math.cos(this.camera.yaw) * Math.cos(this.camera.pitch)
    ];
    
    const right = [
      Math.cos(this.camera.yaw),
      0,
      -Math.sin(this.camera.yaw)
    ];
    
    const speed = this.camera.moveSpeed * dt;
    
    // WASD movement
    if (this.keys['KeyW']) {
      this.camera.position[0] += forward[0] * speed;
      this.camera.position[1] += forward[1] * speed;
      this.camera.position[2] += forward[2] * speed;
    }
    if (this.keys['KeyS']) {
      this.camera.position[0] -= forward[0] * speed;
      this.camera.position[1] -= forward[1] * speed;
      this.camera.position[2] -= forward[2] * speed;
    }
    if (this.keys['KeyA']) {
      this.camera.position[0] -= right[0] * speed;
      this.camera.position[1] -= right[1] * speed;
      this.camera.position[2] -= right[2] * speed;
    }
    if (this.keys['KeyD']) {
      this.camera.position[0] += right[0] * speed;
      this.camera.position[1] += right[1] * speed;
      this.camera.position[2] += right[2] * speed;
    }
    
    // Vertical movement
    if (this.keys['Space']) {
      this.camera.position[1] += speed;
    }
    if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) {
      this.camera.position[1] -= speed;
    }
  }

  dumpBufferState() {
    console.log('═══════════════════════════════════════');
    console.log('🔍 BUFFER STATE DUMP');
    console.log('═══════════════════════════════════════');
    
    // Camera info
    const camChunk = this.chunkManager.worldToChunk(
      this.camera.position[0],
      this.camera.position[1],
      this.camera.position[2]
    );
    console.log(`📍 Camera: World (${this.camera.position[0].toFixed(1)}, ${this.camera.position[1].toFixed(1)}, ${this.camera.position[2].toFixed(1)})`);
    console.log(`📍 Camera: Chunk (${camChunk.cx}, ${camChunk.cy}, ${camChunk.cz})`);
    
    // Memory state
    const memoryChunks = this.chunkManager.chunks.size;
    console.log(`💾 Memory: ${memoryChunks} chunks`);
    console.log(`📤 GPU Uploaded: ${this.uploadedChunkCount} chunks`);
    console.log(`⚠️ Desync: ${Math.abs(memoryChunks - this.uploadedChunkCount)} chunks`);
    
    // Get actual chunks
    const chunks = this.chunkManager.getLoadedChunks();
    
    // Y distribution
    const chunksPerY = {};
    let atCameraY = 0;
    chunks.forEach(ch => {
      chunksPerY[ch.cy] = (chunksPerY[ch.cy] || 0) + 1;
      if (ch.cy === camChunk.cy) atCameraY++;
    });
    console.log(`📊 Y Distribution:`, chunksPerY);
    console.log(`🎯 At Camera Y=${camChunk.cy}: ${atCameraY}/${chunks.length} chunks`);
    
    // Nearby chunks
    const nearby = chunks.filter(ch => {
      const dx = Math.abs(ch.cx - camChunk.cx);
      const dy = Math.abs(ch.cy - camChunk.cy);
      const dz = Math.abs(ch.cz - camChunk.cz);
      return dx <= 3 && dy <= 1 && dz <= 3;
    });
    console.log(`🎯 Within ±3,±1,±3 of camera: ${nearby.length} chunks`);
    console.log('Sample:', nearby.slice(0, 15).map(ch => `(${ch.cx},${ch.cy},${ch.cz})`).join(', '));
    
    // Check for holes
    const missingNearby = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          const cx = camChunk.cx + dx;
          const cy = camChunk.cy + dy;
          const cz = camChunk.cz + dz;
          const key = `${cx},${cy},${cz}`;
          if (!this.chunkManager.chunks.has(key)) {
            missingNearby.push(`(${cx},${cy},${cz})`);
          }
        }
      }
    }
    
    if (missingNearby.length > 0) {
      console.warn(`❌ Missing nearby chunks (within ±2,±1,±2): ${missingNearby.length}`);
      console.warn('Missing:', missingNearby.slice(0, 20).join(', '));
    } else {
      console.log('✅ All nearby chunks loaded!');
    }
    
    console.log('═══════════════════════════════════════');
  }

  trackChunkStability() {
    // Take snapshot every N frames
    if (this.frameCount - this.lastSnapshotFrame < this.snapshotInterval) {
      return;
    }
    
    this.lastSnapshotFrame = this.frameCount;
    const chunks = this.chunkManager.getLoadedChunks();
    const currentSnapshot = new Map();
    
    for (const chunk of chunks) {
      const key = `${chunk.cx},${chunk.cy},${chunk.cz}`;
      currentSnapshot.set(key, {
        cx: chunk.cx,
        cy: chunk.cy,
        cz: chunk.cz,
        nodeCount: chunk.materialSVDAG.nodes.length
      });
    }
    
    // Compare with previous snapshot
    if (this.chunkSnapshots.size > 0) {
      let moved = 0;
      let changed = 0;
      
      for (const [key, oldChunk] of this.chunkSnapshots) {
        const newChunk = currentSnapshot.get(key);
        if (!newChunk) {
          // Chunk was unloaded (expected)
          continue;
        }
        
        // Check if position changed (BUG!)
        if (newChunk.cx !== oldChunk.cx || newChunk.cy !== oldChunk.cy || newChunk.cz !== oldChunk.cz) {
          moved++;
          console.error(`🐛 CHUNK MOVED! ${key} → (${newChunk.cx},${newChunk.cy},${newChunk.cz})`);
        }
        
        // Check if data changed (suspicious)
        if (newChunk.nodeCount !== oldChunk.nodeCount) {
          changed++;
          console.warn(`⚠️ Chunk data changed: ${key} nodes: ${oldChunk.nodeCount} → ${newChunk.nodeCount}`);
        }
      }
      
      if (moved > 0 || changed > 0) {
        console.log(`📊 Stability check: ${moved} moved, ${changed} changed out of ${this.chunkSnapshots.size} tracked`);
      }
    }
    
    this.chunkSnapshots = currentSnapshot;
  }

  updateCameraBuffer() {
    const forward = [
      Math.sin(this.camera.yaw) * Math.cos(this.camera.pitch),
      Math.sin(this.camera.pitch),
      Math.cos(this.camera.yaw) * Math.cos(this.camera.pitch)
    ];
    
    const right = [
      Math.cos(this.camera.yaw),
      0,
      -Math.sin(this.camera.yaw)
    ];
    
    const up = [
      -Math.sin(this.camera.yaw) * Math.sin(this.camera.pitch),
      Math.cos(this.camera.pitch),
      -Math.cos(this.camera.yaw) * Math.sin(this.camera.pitch)
    ];
    
    const aspect = this.canvas.width / this.canvas.height;
    
    const cameraData = new Float32Array([
      ...this.camera.position, this.camera.fov,
      ...forward, aspect,
      ...right, 0,
      ...up, 0
    ]);
    
    this.device.queue.writeBuffer(this.cameraBuffer, 0, cameraData);
  }

  indexToChunk(index, cameraChunk) {
    // Convert request buffer index back to chunk coordinates
    // Reverse of chunkToRequestIndex from shader
    
    const gridSize = this.gridSize;  // 33
    const halfGrid = Math.floor(gridSize / 2);  // 16
    
    // Extract 3D coordinates from 1D index
    const gz = Math.floor(index / (gridSize * gridSize));
    const gy = Math.floor((index % (gridSize * gridSize)) / gridSize);
    const gx = index % gridSize;
    
    // Convert from grid space [0, 33) to relative space [-16, +16]
    const relX = gx - halfGrid;
    const relY = gy - halfGrid;
    const relZ = gz - halfGrid;
    
    // Add camera chunk to get world chunk coordinates
    return {
      cx: cameraChunk.cx + relX,
      cy: cameraChunk.cy + relY,
      cz: cameraChunk.cz + relZ
    };
  }

  async updateChunks() {
    // OLD VISIBILITY SCANNER DISABLED - Request-on-miss handles chunk loading now!
    // This will be fully removed in Stage 5
    return;
    
    /* DISABLED OLD CODE:
    const startTime = performance.now();
    
    // Check if we can reuse cached scan results
    const cameraMoved = this.getCameraDistance(this.lastScanPosition, this.camera.position);
    const framesSinceLastScan = this.frameCount - this.lastScanFrame;
    const canReuseScan = this.lastScanResults && 
                          cameraMoved < this.scanReuseDistance && 
                          framesSinceLastScan < 30;  // Max 30 frames (0.5s at 60fps)
    
    let neededChunks;
    
    if (canReuseScan) {
      // Reuse cached scan + add predictive chunks
      console.log(`♻️ Reusing scan from ${framesSinceLastScan} frames ago (moved ${cameraMoved.toFixed(1)}m)`);
      neededChunks = this.lastScanResults;
      
      // Add predictive chunks (look ahead in movement direction)
      const predictiveChunks = this.getPredictiveChunks();
      neededChunks = [...neededChunks, ...predictiveChunks];
    } else {
      // Phase 1: Visibility scan - detect which chunks rays need
      neededChunks = await this.visibilityScanner.scan(
        this.cameraBuffer,
        512  // max distance (16 chunks × 32) - increased for memory savings!
      );
      
      console.log(`📡 Visibility scan detected ${neededChunks.length} chunks (${(performance.now() - startTime).toFixed(1)}ms)`);
      
      // Cache results
      this.lastScanResults = neededChunks;
      this.lastScanPosition = [...this.camera.position];
      this.lastScanFrame = this.frameCount;
    }
    
    // Phase 2: Check for chunks requested by raymarcher (on-miss requests)
    const missedChunks = this.getMissedChunkRequests();
    if (missedChunks.length > 0) {
      console.log(`🎯 Raymarcher requested ${missedChunks.length} missing chunks`);
      neededChunks = [...neededChunks, ...missedChunks];
    }
    
    // Phase 3: Load detected chunks (up to 100 chunks)
    const maxChunksToLoad = 100;
    const chunksToLoad = neededChunks.slice(0, maxChunksToLoad);
    
    const loadStartTime = performance.now();
    const maxParallel = 8;
    for (let i = 0; i < chunksToLoad.length; i += maxParallel) {
      const batch = chunksToLoad.slice(i, i + maxParallel);
      await Promise.all(batch.map(c => 
        this.chunkManager.loadChunk(c.cx, c.cy, c.cz)
      ));
    }
    
    const loadTime = performance.now() - loadStartTime;
    console.log(`📦 Loaded ${chunksToLoad.length} chunks (${loadTime.toFixed(1)}ms, ${(loadTime/chunksToLoad.length).toFixed(1)}ms per chunk)`);
    
    // Phase 3: Evict non-visible chunks (DISABLED - new system handles this in Stage 4)
    // this.evictNonVisibleChunks(neededChunks);
    console.log(`📊 Total chunks in memory: ${this.chunkManager.chunks.size}`);
    
    // Upload chunk data to GPU
    const chunks = this.chunkManager.getLoadedChunks();
    if (chunks.length === 0) {
      console.warn('⚠️ No chunks loaded');
      return;
    }
    
    // Silent operation - logs removed for clarity
    
    // Build chunk metadata with CORRECT TYPES (mix of f32 and u32)
    const bytesPerChunk = 32;
    const buffer = new ArrayBuffer(chunks.length * bytesPerChunk);
    const floatView = new Float32Array(buffer);
    const uintView = new Uint32Array(buffer);
    
    let nodesOffset = 0;
    let leavesOffset = 0;
    const allNodes = [];
    const allLeaves = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const floatOffset = i * 8;
      const uintOffset = i * 8;
      
      // World offset (chunk position * chunk size) - as FLOATS
      floatView[floatOffset + 0] = chunk.cx * 32;
      floatView[floatOffset + 1] = chunk.cy * 32;
      floatView[floatOffset + 2] = chunk.cz * 32;
      floatView[floatOffset + 3] = 32; // chunk size
      
      // Material SVDAG - store root index + node count - as UINTS!
      const matRootInCombined = nodesOffset + chunk.materialSVDAG.rootIdx;
      uintView[uintOffset + 4] = matRootInCombined;
      uintView[uintOffset + 5] = chunk.materialSVDAG.nodes.length;
      
      // Add material nodes/leaves to combined buffers
      allNodes.push(...chunk.materialSVDAG.nodes);
      allLeaves.push(...chunk.materialSVDAG.leaves);
      
      const matNodesCount = chunk.materialSVDAG.nodes.length;
      nodesOffset += matNodesCount;
      leavesOffset += chunk.materialSVDAG.leaves.length;
      
      // Opaque SVDAG - store root index + node count - as UINTS!
      const opqRootInCombined = nodesOffset + chunk.opaqueSVDAG.rootIdx;
      uintView[uintOffset + 6] = opqRootInCombined;
      uintView[uintOffset + 7] = chunk.opaqueSVDAG.nodes.length;
      
      // Add opaque nodes/leaves to combined buffers
      allNodes.push(...chunk.opaqueSVDAG.nodes);
      allLeaves.push(...chunk.opaqueSVDAG.leaves);
      
      nodesOffset += chunk.opaqueSVDAG.nodes.length;
      leavesOffset += chunk.opaqueSVDAG.leaves.length;
    }
    
    // Upload to GPU
    this.device.queue.writeBuffer(this.chunkMetadataBuffer, 0, buffer);
    this.device.queue.writeBuffer(this.svdagNodesBuffer, 0, new Uint32Array(allNodes));
    this.device.queue.writeBuffer(this.svdagLeavesBuffer, 0, new Uint32Array(allLeaves));
    
    // Update render params
    const renderParams = new Uint32Array([
      chunks.length, // max_chunks
      32, // chunk_size (as u32)
      5, // max_depth
      this.debugMode  // debug_mode
    ]);
    this.device.queue.writeBuffer(this.renderParamsBuffer, 0, renderParams);
    */
  }
  
  evictNonVisibleChunks(visibleChunks) {
    const visibleSet = new Set(
      visibleChunks.map(c => this.chunkManager.getChunkKey(c.cx, c.cy, c.cz))
    );
    
    const toEvict = [];
    for (const [key, chunk] of this.chunkManager.chunks.entries()) {
      if (!visibleSet.has(key)) {
        // Track frames not visible
        chunk.framesHidden = (chunk.framesHidden || 0) + 1;
        
        // Evict if hidden for 60+ frames (1 second at 60fps)
        if (chunk.framesHidden > 60) {
          toEvict.push(key);
        }
      } else {
        chunk.framesHidden = 0;  // Reset counter
      }
    }
    
    for (const key of toEvict) {
      this.chunkManager.chunks.delete(key);
    }
    
    if (toEvict.length > 0) {
      console.log(`🗑️ Evicted ${toEvict.length} non-visible chunks`);
    }
  }
  
  getMissedChunkRequests() {
    // Track which chunks were accessed but missing during last frame
    // This happens when raymarchChunks calls getChunkIndex and gets -1
    
    if (!this.missedChunksLastFrame) {
      this.missedChunksLastFrame = new Set();
      return [];
    }
    
    const requests = [];
    for (const key of this.missedChunksLastFrame) {
      const [cx, cy, cz] = key.split(',').map(Number);
      requests.push({ cx, cy, cz, rayCount: 1 });
    }
    
    // Clear for next frame
    this.missedChunksLastFrame = new Set();
    
    return requests;
  }
  
  recordMissedChunk(worldX, worldY, worldZ) {
    // Called when raymarcher needs a chunk that isn't loaded
    if (!this.missedChunksLastFrame) {
      this.missedChunksLastFrame = new Set();
    }
    
    const chunk = this.chunkManager.worldToChunk(worldX, worldY, worldZ);
    const key = `${chunk.cx},${chunk.cy},${chunk.cz}`;
    this.missedChunksLastFrame.add(key);
  }
  
  getPredictiveChunks() {
    // Look ahead in movement direction
    if (!this.lastScanPosition) return [];
    
    const dx = this.camera.position[0] - this.lastScanPosition[0];
    const dy = this.camera.position[1] - this.lastScanPosition[1];
    const dz = this.camera.position[2] - this.lastScanPosition[2];
    const speed = Math.sqrt(dx*dx + dy*dy + dz*dz);
    
    if (speed < 1.0) return [];  // Not moving much
    
    // Predict position 1 second ahead
    const predictDistance = speed * 60;  // 60 frames ahead
    const predictPos = [
      this.camera.position[0] + (dx / speed) * predictDistance,
      this.camera.position[1] + (dy / speed) * predictDistance,
      this.camera.position[2] + (dz / speed) * predictDistance
    ];
    
    // Get chunks around predicted position
    const predictChunk = this.chunkManager.worldToChunk(
      predictPos[0], predictPos[1], predictPos[2]
    );
    
    const predictiveChunks = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          predictiveChunks.push({
            cx: predictChunk.cx + dx,
            cy: predictChunk.cy + dy,
            cz: predictChunk.cz + dz,
            rayCount: 0
          });
        }
      }
    }
    
    return predictiveChunks;
  }
  
  getCameraDistance(pos1, pos2) {
    const dx = pos1[0] - pos2[0];
    const dy = pos1[1] - pos2[1];
    const dz = pos1[2] - pos2[2];
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
  }

  async readChunkRequests() {
    // Read the request buffer from GPU
    
    const commandEncoder = this.device.createCommandEncoder();
    
    // Copy GPU buffer to staging buffer
    commandEncoder.copyBufferToBuffer(
      this.chunkRequestBuffer, 0,
      this.chunkRequestStaging, 0,
      this.requestBufferSize * 4
    );
    
    this.device.queue.submit([commandEncoder.finish()]);
    
    // Wait for copy to complete and read
    await this.chunkRequestStaging.mapAsync(GPUMapMode.READ);
    const requestData = new Uint32Array(
      this.chunkRequestStaging.getMappedRange()
    );
    
    // Extract non-zero requests
    const requestedChunks = [];
    const cameraChunk = this.chunkManager.worldToChunk(
      this.camera.position[0],
      this.camera.position[1],
      this.camera.position[2]
    );
    
    for (let i = 0; i < this.requestBufferSize; i++) {
      if (requestData[i] > 0) {
        const chunk = this.indexToChunk(i, cameraChunk);
        requestedChunks.push({
          cx: chunk.cx,
          cy: chunk.cy,
          cz: chunk.cz,
          requestCount: requestData[i]  // How many rays requested this chunk
        });
      }
    }
    
    this.chunkRequestStaging.unmap();
    
    // Clear request buffer for next frame
    const clearData = new Uint32Array(this.requestBufferSize);
    this.device.queue.writeBuffer(this.chunkRequestBuffer, 0, clearData);
    
    return requestedChunks;
  }

  async processChunkRequests() {
    // Skip if frozen - don't process any requests
    if (this.isProcessingRequests) {
      return;
    }
    
    this.isProcessingRequests = true;
    
    // Reset per-frame counters
    this.evictedThisFrame = 0;
    
    try {
      // Update camera position for distance-based eviction
      this.chunkManager.updateCameraPosition(
        this.camera.position[0],
        this.camera.position[1],
        this.camera.position[2]
      );
      
      // Read what chunks rays requested
      const requested = await this.readChunkRequests();
      
      // Smart logging: only log significant changes
      const now = performance.now();
      const requestChange = Math.abs(requested.length - this.lastRequestCount);
      const timeSinceLog = now - this.lastLogTime;
      
      if (requested.length === 0) {
        if (this.lastRequestCount > 0) {
          this.stableFrames++;
          if (this.stableFrames === 120) { // 2 seconds stable
            console.log(`✅ Stable: ${this.chunkManager.chunks.size} chunks loaded`);
          }
        }
        this.lastRequestCount = 0;
        return;  // No requests this frame
      }
      
      this.stableFrames = 0;
      
      // Log if: big change (>50 chunks) OR 5 seconds passed
      const shouldLog = requestChange > 50 || timeSinceLog > 5000;
      
      if (shouldLog || requested.length <= 10) {
        const reqStr = requested.length <= 5 
          ? requested.map(r => `(${r.cx},${r.cy},${r.cz})`).join(', ')
          : `${requested.length} chunks`;
        console.log(`📦 ${reqStr}, ${this.chunkManager.chunks.size}/${this.chunkManager.maxCachedChunks} loaded`);
        this.lastLogTime = now;
      }
      
      this.lastRequestCount = requested.length;
      
      // Mark requested chunks as "seen" (update their lastSeen timestamp)
      for (const req of requested) {
        const key = this.chunkManager.getChunkKey(req.cx, req.cy, req.cz);
        const chunk = this.chunkManager.chunks.get(key);
        if (chunk) {
          chunk.lastSeenFrame = now;  // Update last seen time (reuse 'now' from above)
        }
      }
      
      // Sort by request count (chunks hit by most rays first)
      requested.sort((a, b) => b.requestCount - a.requestCount);
      
      // Limit how many we load per frame (prevent stalls)
      const maxPerFrame = 200;  // Increased - we need to keep up with demand!
      const toLoad = requested.slice(0, maxPerFrame);
      
      // Filter out chunks already loaded (cache hits)
      const alreadyLoaded = new Set();
      const needsLoading = toLoad.filter(c => {
        const key = this.chunkManager.getChunkKey(c.cx, c.cy, c.cz);
        const exists = this.chunkManager.chunks.has(key);
        if (exists) alreadyLoaded.add(key);
        return !exists;
      });
      
      this.cacheHitsThisFrame = alreadyLoaded.size;
      this.totalCacheHits += alreadyLoaded.size;
      
      if (alreadyLoaded.size > 0) {
        // Chunks already in memory but shader requested them again
        // This is expected during movement as new rays explore areas
      }
      
      // Load only NEW chunks in parallel batches
      const maxParallel = 8;
      let loaded = 0;
      
      for (let i = 0; i < needsLoading.length; i += maxParallel) {
        const batch = needsLoading.slice(i, i + maxParallel);
        await Promise.all(batch.map(c => 
          this.chunkManager.loadChunk(c.cx, c.cy, c.cz)
            .then(() => loaded++)
            .catch(err => console.warn(`Failed to load chunk (${c.cx},${c.cy},${c.cz}):`, err))
        ));
      }
      
      // Upload to GPU if memory changed OR if there's a desync
      // IMPORTANT: Do this BEFORE eviction so lastSeenFrame is updated!
      const memoryCount = this.chunkManager.chunks.size;
      const desync = memoryCount !== this.uploadedChunkCount;
      
      if (loaded > 0 || desync) {
        if (loaded > 0) {
          console.log(`🔄 Loaded ${loaded} new chunks (total: ${memoryCount})`);
        }
        if (desync && loaded === 0) {
          console.log(`🔧 Sync fix: re-uploading chunks to GPU`);
        }
        this.uploadChunksToGPU();
      }
      
      // Eviction: Hybrid strategy (distance + LRU under pressure + stale cleanup)
      // Run AFTER upload so lastSeenFrame is fresh
      const evicted = this.chunkManager.evictOldChunks(this.camera.position);
      this.evictedThisFrame = evicted;
      this.totalEvicted += evicted;
    } finally {
      this.isProcessingRequests = false;
    }
  }

  chunkHash(x, y, z) {
    // Same hash function as GPU shader
    const p1 = 73856093;
    const p2 = 19349663;
    const p3 = 83492791;
    return ((x * p1) ^ (y * p2) ^ (z * p3)) >>> 0;
  }

  buildChunkHashTable(chunks) {
    const HASH_TABLE_SIZE = 8192;
    const hashTable = new Uint32Array(HASH_TABLE_SIZE);
    hashTable.fill(0xFFFFFFFF);  // Empty marker
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const hash = this.chunkHash(chunk.cx, chunk.cy, chunk.cz);
      let slot = hash % HASH_TABLE_SIZE;
      
      // Linear probing to find empty slot
      let probes = 0;
      while (hashTable[slot] !== 0xFFFFFFFF && probes < 32) {
        slot = (slot + 1) % HASH_TABLE_SIZE;
        probes++;
      }
      
      if (probes < 32) {
        hashTable[slot] = i;  // Store chunk index
      } else {
        console.warn(`⚠️ Hash table full! Couldn't insert chunk (${chunk.cx},${chunk.cy},${chunk.cz})`);
      }
    }
    
    return hashTable;
  }

  buildMetaGrid(chunks) {
    // Stage 7b: Build meta-grid for spatial skipping
    // Group chunks into meta-chunks and mark which are empty/solid
    
    // DEBUG: Check grid before clearing
    const beforeNonZero = Array.from(this.metaGrid).filter(v => v !== 0).length;
    const beforeBadValues = Array.from(this.metaGrid).filter(v => v !== 0 && v !== 1);
    
    this.metaGrid.fill(0);  // 0 = empty/unknown
    
    // DEBUG: Verify fill worked
    const afterFill = Array.from(this.metaGrid).filter(v => v !== 0).length;
    if (afterFill !== 0) {
      console.error(`❌ FILL FAILED! ${afterFill} non-zero values remain after fill(0)`);
    }
    
    const metaSizeX = this.metaChunkSize.x;
    const metaSizeY = this.metaChunkSize.y;
    const metaSizeZ = this.metaChunkSize.z;
    const gridSizeX = this.metaGridSize.x;
    const gridSizeY = this.metaGridSize.y;
    const gridSizeZ = this.metaGridSize.z;
    const centerX = Math.floor(gridSizeX / 2);
    const centerY = Math.floor(gridSizeY / 2);
    const centerZ = Math.floor(gridSizeZ / 2);
    
    let solidCount = 0;
    let markedChunks = 0;
    
    for (const chunk of chunks) {
      // Convert chunk coord to meta-chunk coord
      const metaX = Math.floor(chunk.cx / metaSizeX) + centerX;
      const metaY = Math.floor(chunk.cy / metaSizeY) + centerY;
      const metaZ = Math.floor(chunk.cz / metaSizeZ) + centerZ;
      
      // Check bounds
      if (metaX >= 0 && metaX < gridSizeX && 
          metaY >= 0 && metaY < gridSizeY && 
          metaZ >= 0 && metaZ < gridSizeZ) {
        
        const metaIndex = metaX + metaY * gridSizeX + metaZ * gridSizeX * gridSizeY;
        
        // Check if chunk has content (Material DAG only now)
        const matNodes = chunk.materialSVDAG?.nodes?.length || 0;
        
        // Has content if Material DAG has nodes
        const hasContent = matNodes > 1;
        
        // DEBUG: Log suspicious cases only
        if (!hasContent && matNodes > 0) {
          console.warn(`⚠️ Chunk (${chunk.cx},${chunk.cy},${chunk.cz}) has nodes but marked empty: matNodes=${matNodes}`);
        }
        
        // If ANY chunk in this meta-chunk has content, mark the whole meta-chunk as solid
        if (hasContent) {
          markedChunks++;
          if (this.metaGrid[metaIndex] === 0) {
            this.metaGrid[metaIndex] = 1;  // Mark meta-chunk as has content
            solidCount++;  // Count meta-chunks, not individual chunks
          }
        }
      }
    }
    
    // DEBUG: Always log for first 10 frames or periodically
    const afterNonZero = Array.from(this.metaGrid).filter(v => v !== 0).length;
    const afterBadValues = Array.from(this.metaGrid).filter(v => v !== 0 && v !== 1);
    
    if (this.frameCount < 60 || this.frameCount % 60 === 0) {
      console.log(`🗺️ META-GRID BUILD [F${this.frameCount}]: ${markedChunks}/${chunks.length} chunks → ${solidCount} meta-chunks, before=${beforeNonZero}/${beforeBadValues.length} bad, after=${afterNonZero}/${afterBadValues.length} bad`);
      
      if (beforeBadValues.length > 0) {
        console.error(`❌ BAD VALUES BEFORE BUILD:`, beforeBadValues.slice(0, 10));
      }
      if (afterBadValues.length > 0) {
        console.error(`❌ BAD VALUES AFTER BUILD:`, afterBadValues.slice(0, 10));
      }
    }
  }

  uploadChunksToGPU() {
    // Get all loaded chunks and upload to GPU
    // NOTE: No sorting! Hash table handles lookup, order doesn't matter.
    // Map.values() returns chunks in insertion order (stable but not sorted)
    const chunks = this.chunkManager.getLoadedChunks();
    if (chunks.length === 0) {
      return;
    }
    
    // Update lastSeenFrame for all chunks being uploaded (they're actively rendered)
    const now = Date.now();
    let updatedCount = 0;
    for (const chunk of chunks) {
      const oldTimestamp = chunk.lastSeenFrame;
      chunk.lastSeenFrame = now;  // Direct update works (arrays contain references)
      if (oldTimestamp < 1000 || !oldTimestamp) {
        console.warn(`⚠️ Chunk (${chunk.cx},${chunk.cy},${chunk.cz}) had bad timestamp ${oldTimestamp}, fixed to ${now}`);
      }
      updatedCount++;
    }
    if (this.frameCount % 300 === 0 && updatedCount > 0) {
      console.log(`✅ Updated lastSeenFrame for ${updatedCount} chunks`);
    }
    
    // CRITICAL: Track uploaded count for render() to use
    const oldCount = this.uploadedChunkCount;
    this.uploadedChunkCount = chunks.length;
    const countChanged = oldCount !== this.uploadedChunkCount;
    this.lastUploadCount = chunks.length;
    
    if (countChanged || this.frameCount % 300 === 0) {
      const sample = chunks.slice(0, 5).map(c => `(${c.cx},${c.cy},${c.cz})`).join(', ');
      const minY = Math.min(...chunks.map(c => c.cy));
      const maxY = Math.max(...chunks.map(c => c.cy));
      const yLevels = new Set(chunks.map(c => c.cy)).size;
      console.log(`📤 GPU Upload: ${chunks.length} chunks | Y:${minY}..${maxY} (${yLevels} levels) | First 5: ${sample} (sorted!)`);
    }
    
    // Log detailed info periodically
    if (chunks.length > 0 && this.frameCount % 120 === 0) {
      const camChunk = this.chunkManager.worldToChunk(this.camera.position[0], this.camera.position[1], this.camera.position[2]);
      
      const c = chunks[0];
      console.log(`🔍 First chunk detail:`, {
        coords: `(${c.cx}, ${c.cy}, ${c.cz})`,
        worldOffset: [c.cx * 32, c.cy * 32, c.cz * 32],
        matNodes: c.materialSVDAG?.nodes?.length || 0,
        matLeaves: c.materialSVDAG?.leaves?.length || 0,
        opqNodes: c.opaqueSVDAG?.nodes?.length || 0,
        opqLeaves: c.opaqueSVDAG?.leaves?.length || 0,
        matRootIdx: c.materialSVDAG?.rootIdx,
        opqRootIdx: c.opaqueSVDAG?.rootIdx
      });
      
      // Count chunks per Y level and check for empty chunks
      const chunksPerY = {};
      let emptyCount = 0;
      let atCameraY = 0;
      
      chunks.forEach(ch => {
        chunksPerY[ch.cy] = (chunksPerY[ch.cy] || 0) + 1;
        if (ch.cy === camChunk.cy) atCameraY++;
        // Check if chunk is empty (no voxels)
        const isEmpty = (ch.opaqueSVDAG?.nodes?.length || 0) === 0 && 
                       (ch.materialSVDAG?.nodes?.length || 0) === 0;
        if (isEmpty) emptyCount++;
      });
      
      console.log(`📊 Chunks per Y level:`, chunksPerY);
      console.log(`📍 Camera chunk: (${camChunk.cx}, ${camChunk.cy}, ${camChunk.cz})`);
      console.warn(`⚠️ Only ${atCameraY}/${chunks.length} chunks at camera Y=${camChunk.cy} | Missing ${chunks.length - atCameraY} chunks!`);
      
      if (emptyCount > 0) {
        console.warn(`⚠️ ${emptyCount}/${chunks.length} chunks are EMPTY (all air)!`);
      }
      
      // Sample some chunks near camera Y to see what's loaded
      const nearCameraY = chunks.filter(ch => Math.abs(ch.cy - camChunk.cy) <= 1);
      console.log(`🎯 Chunks within ±1 Y of camera (Y=${camChunk.cy}): ${nearCameraY.length} | Sample:`, 
        nearCameraY.slice(0, 10).map(ch => `(${ch.cx},${ch.cy},${ch.cz})`).join(', '));
    }
    
    // Validate all chunks have valid positions
    let invalidCount = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk.cx === undefined || chunk.cy === undefined || chunk.cz === undefined) {
        invalidCount++;
        console.error(`🐛 BUG: Chunk ${i} missing coordinates!`, chunk);
      }
    }
    if (invalidCount > 0) {
      console.error(`🐛 CRITICAL: ${invalidCount}/${chunks.length} chunks have invalid coordinates!`);
    }
    
    // Build chunk metadata - MATERIAL DAG ONLY (single-DAG system)
    // Struct layout: vec3<f32> (12) + f32 (4) + 2x u32 (8) + 2x u32 padding (8) = 32 bytes per chunk
    // GPU requires 16-byte alignment, so we pad to 32 bytes
    const bytesPerChunk = 32;
    const buffer = new ArrayBuffer(chunks.length * bytesPerChunk);
    const floatView = new Float32Array(buffer);
    const uintView = new Uint32Array(buffer);
    
    let nodesOffset = 0;
    let leavesOffset = 0;
    const allNodes = [];
    const allLeaves = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const floatOffset = i * 8;  // 8 x 4-byte values = 32 bytes
      const uintOffset = i * 8;
      
      // CRITICAL: Validate chunk has coordinates
      if (chunk.cx === undefined || chunk.cy === undefined || chunk.cz === undefined) {
        console.error(`🐛 BUG: Chunk at index ${i} missing coordinates!`, chunk);
        continue;
      }
      
      // World offset (chunk position * chunk size) - as FLOATS
      floatView[floatOffset + 0] = chunk.cx * 32;
      floatView[floatOffset + 1] = chunk.cy * 32;
      floatView[floatOffset + 2] = chunk.cz * 32;
      floatView[floatOffset + 3] = 32; // chunk size
      
      // Material SVDAG - store root index (offset into combined buffer) + node count - as UINTS!
      const matRootInCombined = nodesOffset + chunk.materialSVDAG.rootIdx;
      uintView[uintOffset + 4] = matRootInCombined;
      uintView[uintOffset + 5] = chunk.materialSVDAG.nodes.length;
      // uintView[uintOffset + 6] = 0;  // padding1 (optional, already zero)
      // uintView[uintOffset + 7] = 0;  // padding2 (optional, already zero)
      
      // Add material nodes/leaves to combined buffers
      allNodes.push(...chunk.materialSVDAG.nodes);
      allLeaves.push(...chunk.materialSVDAG.leaves);
      
      nodesOffset += chunk.materialSVDAG.nodes.length;
      leavesOffset += chunk.materialSVDAG.leaves.length;
    }
    
    // Upload to GPU (use the ArrayBuffer directly)
    this.device.queue.writeBuffer(this.chunkMetadataBuffer, 0, buffer);
    this.device.queue.writeBuffer(this.svdagNodesBuffer, 0, new Uint32Array(allNodes));
    this.device.queue.writeBuffer(this.svdagLeavesBuffer, 0, new Uint32Array(allLeaves));
    
    // Build and upload hash table for O(1) chunk lookups
    const hashTable = this.buildChunkHashTable(chunks);
    this.device.queue.writeBuffer(this.chunkHashTableBuffer, 0, hashTable);
    
    // Hash table uploaded (debug logging disabled)
    
    // Stage 7b: Build and upload meta-grid for spatial skipping
    this.buildMetaGrid(chunks);
    
    // DEBUG: Verify BEFORE upload
    const beforeUpload = [];
    for (let i = 0; i < this.metaGrid.length; i++) {
      if (this.metaGrid[i] !== 0) {
        beforeUpload.push(this.metaGrid[i]);
      }
    }
    
    // Upload to GPU - ALWAYS log first frame to verify setup
    const expectedBytes = 16 * 16 * 16 * 4;  // 16KB for u32 array
    const actualBytes = this.metaGrid.byteLength;
    const arrayType = this.metaGrid.constructor.name;
    
    // Log type info on first upload
    if (this.frameCount <= 20) {
      console.log(`📊 [F${this.frameCount}] Uploading ${arrayType}, ${actualBytes} bytes`);
    }
    
    if (actualBytes !== expectedBytes) {
      console.error(`❌ BUFFER SIZE MISMATCH! Expected ${expectedBytes} bytes, got ${actualBytes} bytes`);
    }
    
    if (arrayType !== 'Uint32Array') {
      console.error(`❌ WRONG ARRAY TYPE! Expected Uint32Array, got ${arrayType}`);
    }
    
    // Write to GPU buffer
    this.device.queue.writeBuffer(this.metaGridBuffer, 0, this.metaGrid);
    
    // CRITICAL: Verify the buffer size matches what we're uploading
    if (this.metaGridBuffer.size !== expectedBytes) {
      console.error(`❌ GPU BUFFER SIZE WRONG! Buffer is ${this.metaGridBuffer.size} bytes, should be ${expectedBytes} bytes`);
    }
    
    // SMOKING GUN TEST: Read back values around where chunks should be (indices 2190-2210)
    // Chunks near (0,4,0) map to meta-index ~2200
    if (this.frameCount >= 20 && this.frameCount <= 25 && !this.metaGridReadbackDone) {
      this.metaGridReadbackDone = true;
      
      console.log(`🔬 Starting GPU readback at frame ${this.frameCount}...`);
      
      const startIndex = 2190;  // Check around where (0,4,0) chunks should map
      const count = 20;
      const readBuffer = this.device.createBuffer({
        size: count * 4, // 20 u32 values = 80 bytes
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      });
      
      const commandEncoder = this.device.createCommandEncoder();
      commandEncoder.copyBufferToBuffer(this.metaGridBuffer, startIndex * 4, readBuffer, 0, count * 4);
      this.device.queue.submit([commandEncoder.finish()]);
      
      // Read back asynchronously
      readBuffer.mapAsync(GPUMapMode.READ).then(() => {
        const data = new Uint32Array(readBuffer.getMappedRange());
        const values = Array.from(data);
        console.log(`🔬 GPU READBACK [F${this.frameCount}]: Values at indices [${startIndex}-${startIndex+count-1}]:`, values);
        
        // Also log which JS values should be there
        const jsValues = Array.from(this.metaGrid.slice(startIndex, startIndex + count));
        console.log(`📋 JavaScript array at same indices:`, jsValues);
        
        const badGPU = values.filter(v => v !== 0 && v !== 1);
        if (badGPU.length > 0) {
          console.error(`❌ GPU HAS CORRUPT DATA! Found ${badGPU.length} bad values:`, badGPU);
        } else {
          // Check if JS and GPU match
          const matches = values.every((v, i) => v === jsValues[i]);
          if (matches) {
            console.log(`✅ GPU data MATCHES JavaScript! Upload is working correctly!`);
          } else {
            console.error(`❌ GPU data DIFFERS from JavaScript! Upload or buffer issue!`);
          }
        }
        readBuffer.unmap();
        readBuffer.destroy();
      });
    }
    
    // DEBUG: Verify AFTER upload
    const afterUpload = [];
    const badValues = [];
    for (let i = 0; i < this.metaGrid.length; i++) {
      const val = this.metaGrid[i];
      if (val !== 0) {
        afterUpload.push(val);
        if (val !== 1) {
          badValues.push(val);
        }
      }
    }
    
    // Log summary every upload
    console.log(`📤 [F${this.frameCount}] Meta-grid: BEFORE=${beforeUpload.length}, AFTER=${afterUpload.length}, BAD=${badValues.length}`);
    if (beforeUpload.length !== afterUpload.length) {
      console.error(`❌ ARRAY MODIFIED DURING UPLOAD! Before: ${beforeUpload.length}, After: ${afterUpload.length}`);
    }
    if (badValues.length > 0) {
      console.error(`❌ CORRUPT VALUES:`, badValues.slice(0, 20));
    }
    
    // Track GPU memory usage
    this.gpuMemoryUsed.metadata = buffer.byteLength;
    this.gpuMemoryUsed.nodes = allNodes.length * 4;  // u32 = 4 bytes
    this.gpuMemoryUsed.leaves = allLeaves.length * 4;
    
    // Metadata uploaded successfully
    
    // Note: renderParams now updated every frame in render() loop
  }

  async render() {
    // Update time
    const now = performance.now();
    const dt = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;
    this.time += dt;
    this.frameCount++;
    
    // FPS tracking
    this.fpsFrames.push(1 / dt);
    if (this.fpsFrames.length > 60) this.fpsFrames.shift();
    this.fps = this.fpsFrames.reduce((a, b) => a + b, 0) / this.fpsFrames.length;
    
    // Update movement
    this.updateMovement(dt);
    
    // Track chunk stability
    this.trackChunkStability();
    
    // OLD SYSTEM DISABLED - updateChunks uses visibility scanner
    // Request-on-miss (processChunkRequests) handles everything now!
    // if (!this.freezeChunks && this.frameCount % this.chunkUpdateInterval === 0) {
    //   await this.updateChunks();
    // }
    
    // Update buffers
    this.updateCameraBuffer();
    
    // Calculate adaptive limits based on memory pressure
    const pressure = this.chunkManager.chunks.size / (this.chunkManager.maxCachedChunks * 0.6);
    
    // Reduce limits when under pressure
    let maxDistance = 2048.0;  // Full distance
    let maxChunkSteps = 128;   // Full steps
    
    if (pressure > 1.5) {  // 150%+ pressure (4500+ chunks)
      maxDistance = 512.0;   // Very restricted
      maxChunkSteps = 32;
    } else if (pressure > 1.2) {  // 120%+ pressure (3600+ chunks)
      maxDistance = 1024.0;  // Restricted
      maxChunkSteps = 64;
    } else if (pressure > 1.0) {  // 100%+ pressure (3000+ chunks)
      maxDistance = 1536.0;  // Slightly restricted
      maxChunkSteps = 96;
    }
    
    // Store for HUD display
    this.adaptiveMaxDistance = maxDistance;
    this.adaptiveMaxChunkSteps = maxChunkSteps;
    
    // Update render params EVERY frame (includes debug mode!)
    // Struct: time, max_chunks, chunk_size, max_depth, debug_mode, max_distance, max_chunk_steps, meta_skip_enabled
    const renderParamsBuffer = new ArrayBuffer(32);  // 8 * 4 bytes
    const renderParamsView = new DataView(renderParamsBuffer);
    
    renderParamsView.setFloat32(0, this.time, true);  // time
    renderParamsView.setUint32(4, this.uploadedChunkCount, true);  // max_chunks
    renderParamsView.setFloat32(8, 32.0, true);  // chunk_size
    renderParamsView.setUint32(12, 5, true);  // max_depth
    renderParamsView.setUint32(16, this.debugMode, true);  // debug_mode
    renderParamsView.setFloat32(20, maxDistance, true);  // max_distance
    renderParamsView.setUint32(24, maxChunkSteps, true);  // max_chunk_steps
    renderParamsView.setUint32(28, this.metaSkipEnabled ? 1 : 0, true);  // meta_skip_enabled
    
    this.device.queue.writeBuffer(this.renderParamsBuffer, 0, renderParamsBuffer);
    
    // VERIFY: Log if there's a SIGNIFICANT mismatch (ignore small timing differences)
    const memoryChunks = this.chunkManager.chunks.size;
    const diff = Math.abs(this.uploadedChunkCount - memoryChunks);
    const percentDiff = memoryChunks > 0 ? (diff / memoryChunks) * 100 : 0;
    
    // Only warn if difference is > 10% or > 100 chunks (indicates real problem)
    if (this.frameCount % 120 === 0 && diff > 100 && percentDiff > 10) {
      console.warn(`⚠️ Large desync: GPU has ${this.uploadedChunkCount} chunks, memory has ${memoryChunks} (${percentDiff.toFixed(1)}% diff)`);
    }
    
    const timeData = new Float32Array([
      this.time,
      (Math.sin(this.time * 0.1) + 1) * 0.5, // Time of day
      200.0, // Fog start
      500.0  // Fog end
    ]);
    this.device.queue.writeBuffer(this.timeParamsBuffer, 0, timeData);
    
    const commandEncoder = this.device.createCommandEncoder();
    
    // 1. Dispatch compute shader (render to rgba texture)
    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(this.pipeline);
    computePass.setBindGroup(0, this.bindGroup);
    computePass.dispatchWorkgroups(
      Math.ceil(this.canvas.width / 8),
      Math.ceil(this.canvas.height / 8)
    );
    computePass.end();
    
    // 2. Blit rgba texture to canvas (bgra)
    const blitBindGroup = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.computeTexture.createView() },
        { binding: 1, resource: this.blitSampler }
      ]
    });
    
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });
    renderPass.setPipeline(this.blitPipeline);
    renderPass.setBindGroup(0, blitBindGroup);
    renderPass.draw(6);
    renderPass.end();
    
    this.device.queue.submit([commandEncoder.finish()]);
    
    // Update debug HUD
    this.updateDebugHUD();
    
    // Process chunk requests (async, don't block)
    // Skip first few frames while system initializes
    if (this.frameCount > 10) {
      this.processChunkRequests().catch(err => 
        console.error('Error processing chunk requests:', err)
      );
    }
  }

  moveCamera(forward, right, up) {
    const speed = this.camera.moveSpeed * 0.016; // Assume 60fps
    
    const fwd = [
      Math.sin(this.camera.yaw),
      0,
      Math.cos(this.camera.yaw)
    ];
    
    const rgt = [
      Math.cos(this.camera.yaw),
      0,
      -Math.sin(this.camera.yaw)
    ];
    
    this.camera.position[0] += fwd[0] * forward * speed + rgt[0] * right * speed;
    this.camera.position[1] -= up * speed;  // Inverted Y: Space now flies UP (scene moves down)
    this.camera.position[2] += fwd[2] * forward * speed + rgt[2] * right * speed;
  }

  rotateCamera(dyaw, dpitch) {
    this.camera.yaw += dyaw * this.camera.lookSpeed;
    this.camera.pitch += dpitch * this.camera.lookSpeed;
    this.camera.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.camera.pitch));
  }

  getStats() {
    return {
      camera: this.camera.position,
      chunks: this.chunkManager.getStats()
    };
  }
}
