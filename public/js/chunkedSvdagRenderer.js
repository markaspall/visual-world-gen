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
    
    // Chunk miss tracking (raymarcher requests missing chunks)
    this.chunkMissBuffer = null;
    this.chunkMissStaging = null;
    this.maxChunkRequests = 100;  // Track up to 100 missed chunks per frame
    
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
    this.debugMode = 1; // Start with Depth mode to see terrain (0=normal, 1=depth, 2=chunks, 3=normals, 4=steps, 5=dag)
    this.centerRayHit = null; // What the center of screen is looking at
    
    // Stats
    this.lastFrameTime = performance.now();
    this.time = 0;
    
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
    
    // Create visibility scanner
    this.visibilityScanner = new VisibilityScanner(this.device, this.camera, 32);
    await this.visibilityScanner.init();
    
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
      size: 16,
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
    
    // Create placeholder buffers (will be updated when chunks load)
    this.chunkMetadataBuffer = this.device.createBuffer({
      size: 1024 * 32, // 100 chunks max
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
        { binding: 6, resource: { buffer: this.materialsBuffer } }
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

  async updateChunks() {
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
    
    // Phase 3: Evict non-visible chunks
    this.evictNonVisibleChunks(neededChunks);
    console.log(`📊 Total chunks in memory: ${this.chunkManager.chunks.size}`);
    
    // Upload chunk data to GPU
    const chunks = this.chunkManager.getLoadedChunks();
    if (chunks.length === 0) {
      console.warn('⚠️ No chunks loaded');
      return;
    }
    
    // Silent operation - logs removed for clarity
    
    // Build chunk metadata
    const metadata = new Float32Array(chunks.length * 8);
    let nodesOffset = 0;
    let leavesOffset = 0;
    const allNodes = [];
    const allLeaves = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const offset = i * 8;
      
      // World offset (chunk position * chunk size)
      metadata[offset + 0] = chunk.cx * 32;
      metadata[offset + 1] = chunk.cy * 32;
      metadata[offset + 2] = chunk.cz * 32;
      metadata[offset + 3] = 32; // chunk size
      
      // Material SVDAG - store root index (offset into combined buffer) + node count
      const matRootInCombined = nodesOffset + chunk.materialSVDAG.rootIdx;
      metadata[offset + 4] = matRootInCombined;
      metadata[offset + 5] = chunk.materialSVDAG.nodes.length;
      
      // Add material nodes/leaves to combined buffers
      allNodes.push(...chunk.materialSVDAG.nodes);
      allLeaves.push(...chunk.materialSVDAG.leaves);
      
      const matNodesCount = chunk.materialSVDAG.nodes.length;
      nodesOffset += matNodesCount;
      leavesOffset += chunk.materialSVDAG.leaves.length;
      
      // Opaque SVDAG - store root index (offset into combined buffer) + node count
      const opqRootInCombined = nodesOffset + chunk.opaqueSVDAG.rootIdx;
      metadata[offset + 6] = opqRootInCombined;
      metadata[offset + 7] = chunk.opaqueSVDAG.nodes.length;
      
      // Add opaque nodes/leaves to combined buffers
      allNodes.push(...chunk.opaqueSVDAG.nodes);
      allLeaves.push(...chunk.opaqueSVDAG.leaves);
      
      nodesOffset += chunk.opaqueSVDAG.nodes.length;
      leavesOffset += chunk.opaqueSVDAG.leaves.length;
    }
    
    // Upload to GPU
    this.device.queue.writeBuffer(this.chunkMetadataBuffer, 0, metadata);
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

  async render() {
    // Update time
    const now = performance.now();
    const dt = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;
    this.time += dt;
    
    // Update chunks periodically (not every frame)
    if (this.frameCount % this.chunkUpdateInterval === 0) {
      await this.updateChunks();
    }
    this.frameCount++;
    
    // Update buffers
    this.updateCameraBuffer();
    
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
