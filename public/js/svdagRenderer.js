/**
 * SVDAG Renderer - Hierarchical voxel ray marching
 */

// SVDAG Builder (simplified version integrated into renderer)
class SVDAGBuilder {
  constructor(size, maxDepth) {
    this.size = size;
    this.maxDepth = maxDepth;
    this.nodes = [];
    this.leaves = [];
    this.nodeMap = new Map();
  }

  build(voxelGrid) {
    console.log('Building SVDAG from voxel grid...');
    console.log('Grid size:', this.size, 'Depth:', this.maxDepth, 'Total voxels:', voxelGrid.length);
    const startTime = performance.now();
    
    console.log('⏱️ Phase 1: Building octree...');
    const octreeStart = performance.now();
    const root = this.buildNode(voxelGrid, 0, 0, 0, this.size, 0);
    const octreeTime = ((performance.now() - octreeStart) / 1000).toFixed(2);
    console.log(`✅ Octree built in ${octreeTime}s`);
    
    console.log('⏱️ Phase 2: Flattening to DAG (deduplicating nodes)...');
    const flattenStart = performance.now();
    this.flattenProgress = 0;
    this.flattenTotal = 0;
    const rootIdx = this.flattenNode(root);
    const flattenTime = ((performance.now() - flattenStart) / 1000).toFixed(2);
    console.log(`✅ DAG flattened in ${flattenTime}s`);
    
    const buildTime = (performance.now() - startTime).toFixed(2);
    
    const totalTimeS = (buildTime / 1000).toFixed(2);
    const stats = {
      totalNodes: Math.floor(this.nodes.length / 3),
      totalLeaves: this.leaves.length,
      buildTimeS: totalTimeS,
      octreeTimeS: octreeTime,
      flattenTimeS: flattenTime,
      compressionRatio: (1 - (this.nodes.length + this.leaves.length) / voxelGrid.length).toFixed(3),
      dedupSavings: this.nodeMap.size
    };
    
    console.log('✅ SVDAG built successfully!');
    console.log(`   Total time: ${totalTimeS}s (Octree: ${octreeTime}s, Flatten: ${flattenTime}s)`);
    console.log(`   Nodes: ${stats.totalNodes}, Leaves: ${stats.totalLeaves}`);
    console.log(`   Compression: ${stats.compressionRatio} (DAG saved ${stats.dedupSavings} duplicate nodes)`);
    
    // Debug: Show first few nodes
    console.log('First 20 node values:', this.nodes.slice(0, 20));
    console.log('First 10 leaf values:', this.leaves.slice(0, 10));
    console.log('Root index:', rootIdx);
    
    return {
      nodesBuffer: new Uint32Array(this.nodes),
      leavesBuffer: new Uint32Array(this.leaves),
      rootIdx,
      stats,
    };
  }

  buildNode(voxelGrid, x, y, z, size, depth) {
    if (depth === this.maxDepth || size === 1) {
      const idx = this.getVoxelIndex(x, y, z);
      const blockId = voxelGrid[idx] || 0;
      
      // Return null for air (blockId=0) - air nodes are pruned
      if (blockId === 0) {
        return null;
      }
      
      return { isLeaf: true, blockId };
    }

    const halfSize = Math.floor(size / 2);
    const children = [];
    let childMask = 0;

    for (let i = 0; i < 8; i++) {
      const cx = x + (i & 1 ? halfSize : 0);
      const cy = y + (i & 2 ? halfSize : 0);
      const cz = z + (i & 4 ? halfSize : 0);

      const child = this.buildNode(voxelGrid, cx, cy, cz, halfSize, depth + 1);
      
      if (child) {
        children[i] = child;
        childMask |= (1 << i);
      }
    }

    if (childMask === 0) {
      return null;
    }

    return { isLeaf: false, childMask, children };
  }

  flattenNode(node) {
    if (!node) {
      return 0; // Null nodes = air, no index needed
    }

    // Progress tracking (log every 10000 nodes)
    this.flattenProgress = (this.flattenProgress || 0) + 1;
    if (this.flattenProgress % 10000 === 0) {
      const nodeCount = Math.floor(this.nodes.length / 3);
      const mapSize = this.nodeMap.size;
      console.log(`  ... processed ${this.flattenProgress} nodes, created ${nodeCount} unique nodes, DAG saved ${mapSize} duplicates`);
    }

    let nodeIdx;

    if (node.isLeaf) {
      // Leaf: [tag=1, leaf_data_idx]
      // DO NOT merge leaves - each leaf is unique in space
      nodeIdx = this.nodes.length;
      const leafIdx = this.leaves.length;
      
      this.nodes.push(1); // tag=1 for leaf
      this.nodes.push(leafIdx); // index into leaves buffer
      this.leaves.push(node.blockId);
    } else {
      // Inner node: Try DAG merging (only merge identical INNER nodes)
      const hash = this.hashNode(node);
      if (this.nodeMap.has(hash)) {
        return this.nodeMap.get(hash); // Reuse existing inner node
      }
      
      // Reserve space for this node FIRST to avoid circular refs
      nodeIdx = this.nodes.length;
      this.nodes.push(0); // tag=0 for inner
      this.nodes.push(node.childMask);
      
      // Reserve space for child indices (will fill in next)
      const childIndicesStart = this.nodes.length;
      let childCount = 0;
      for (let i = 0; i < 8; i++) {
        if (node.childMask & (1 << i)) {
          this.nodes.push(0); // Placeholder
          childCount++;
        }
      }

      // Now recursively flatten children and fill in the indices
      let childSlot = 0;
      for (let i = 0; i < 8; i++) {
        if (node.childMask & (1 << i)) {
          const childIdx = this.flattenNode(node.children[i]);
          this.nodes[childIndicesStart + childSlot] = childIdx;
          childSlot++;
        }
      }
      
      // Only cache inner nodes for DAG merging
      this.nodeMap.set(hash, nodeIdx);
    }

    return nodeIdx;
  }

  hashNode(node) {
    // Compute hash bottom-up (cache it after first computation)
    if (node._hash !== undefined) {
      return node._hash;
    }
    
    if (node.isLeaf) {
      node._hash = `L${node.blockId}`;
      return node._hash;
    }
    
    // For inner nodes, hash child indices (computed during flatten)
    const parts = [node.childMask];
    for (let i = 0; i < 8; i++) {
      if (node.childMask & (1 << i)) {
        parts.push(this.hashNode(node.children[i]));
      }
    }
    node._hash = parts.join('|');
    return node._hash;
  }

  getVoxelIndex(x, y, z) {
    return z * this.size * this.size + y * this.size + x;
  }
}

export class SvdagRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.device = null;
    this.context = null;
    this.svdag = null;
    
    this.camera = {
      position: [85, 140, 85],  // Above terrain (max ~120m) for safe spawn
      rotation: [0, -Math.PI / 4],  // Look down 45 degrees
      fov: 75 * Math.PI / 180,
      speed: 20.0,  // Faster for larger world
      mouseSensitivity: 0.002
    };
    
    this.debugFlags = {
      showTerrain: true,
      showWater: true,
      debugWaterValues: false,  // Repurposed for "flat colors" mode
      debugDAGLevels: false,
      debugStepCount: false
    };
    
    this.epsilonScale = 0.0; // User-adjustable epsilon (0-10)
    this.reverseStack = false; // FIFO vs LIFO
    this.sortChildren = false; // Sort children by distance
    this.earlyExit = false; // Exit on first hit (old behavior)
    
    // Bloom settings
    this.enableBloom = false;  // Toggle bloom effect - DISABLED for performance
    this.bloomThreshold = 0.7;  // Brightness threshold for bloom (0-1)
    this.bloomIntensity = 0.4;  // How strong the bloom is (0-1)
    
    // Frame caching / dirty flags
    this.frameDirty = true;  // Always render first frame
    this.pauseTime = false;  // FREEZE TIME - set to false to enable day/night cycle
    this.lastCameraState = null;
    this.lastTimeState = null;
    this.framesSaved = 0;
    
    this.perfFlags = {
      enableShadows: true,
      enableReflections: true,
      enableFog: true,
      enableEarlyExit: true,
      enableWaterAnimation: true,
      increaseShadowBias: false,
      showVoxelGrid: false
    };
    
    this.time = 0;
  }

  async initialize(worldData) {
    console.log('Initializing SVDAG renderer...');
    
    // Setup WebGPU
    if (!navigator.gpu) {
      throw new Error('WebGPU not supported');
    }
    
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('No GPU adapter found');
    }
    
    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext('webgpu');
    
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: format,
      alphaMode: 'opaque'
    });
    
    // Build SVDAG from world data
    await this.buildSVDAG(worldData);
    
    // Create rendering pipeline
    await this.createPipeline();
    
    console.log('SVDAG renderer initialized');
  }

  async loadPNGAsFloatArray(url) {
    const img = await this.loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, img.width, img.height);
    const data = imageData.data;
    
    const floatArray = new Float32Array(img.width * img.height);
    for (let i = 0; i < floatArray.length; i++) {
      floatArray[i] = data[i * 4] / 255.0;
    }
    return floatArray;
  }

  async loadPNGAsUintArray(url) {
    const img = await this.loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, img.width, img.height);
    const data = imageData.data;
    
    const uintArray = new Uint32Array(img.width * img.height);
    for (let i = 0; i < uintArray.length; i++) {
      uintArray[i] = data[i * 4];
    }
    return uintArray;
  }

  async loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  async buildSVDAG(worldData) {
    console.log('Building SVDAG from world data...');
    
    // Load PNG data
    const files = worldData.files;
    
    console.log('Loading heightmap from PNG...');
    const heightData = await this.loadPNGAsFloatArray(files.heightLOD0);
    
    console.log('Loading blocks map from PNG...');
    const blocksData = files.terrainBlocks 
      ? await this.loadPNGAsUintArray(files.terrainBlocks)
      : new Uint32Array(512 * 512).fill(1);
    
    console.log('Loading water map from PNG...');
    const waterData = files.waterHeight
      ? await this.loadPNGAsFloatArray(files.waterHeight)
      : new Float32Array(512 * 512).fill(0);
    
    // High resolution: 256x256x256 @ 0.66m voxels (512³ uses too much memory!)
    const sourceSize = 512;
    const gridSize = 256;
    const gridHeight = 256;
    
    const voxelGrid = new Uint32Array(gridSize * gridHeight * gridSize);
    
    console.log(`Creating ${gridSize}x${gridHeight}x${gridSize} voxel grid (full resolution)...`);
    console.log('⏳ Building full-resolution SVDAG... this may take 5-10 seconds');
    
    let filledVoxels = 0;
    let waterVoxels = 0;
    let maxHeight = 0;
    
    // TEST PATTERN OVERRIDE
    if (window.svdagTestPattern) {
      console.log('🧪 Using test pattern:', window.svdagTestPattern);
      this.fillTestPattern(voxelGrid, gridSize, gridHeight, window.svdagTestPattern);
      filledVoxels = voxelGrid.filter(v => v > 0).length;
    } else {
      // Fill voxel grid - downsample from 512x512 source to 256x256x256 grid
      for (let x = 0; x < gridSize; x++) {
        for (let z = 0; z < gridSize; z++) {
          // Sample every 2nd pixel
          const srcX = x * 2;
          const srcZ = z * 2;
          const idx = srcZ * sourceSize + srcX;
          
          const terrainHeight = Math.floor(heightData[idx] * 256);  // Scale to 256 height
          const waterDepth = waterData[idx];  // 0-1, represents water level
          const blockType = blocksData[idx] || 6;
          
          if (terrainHeight > maxHeight) maxHeight = terrainHeight;
          
          // Fill terrain
          for (let y = 0; y <= terrainHeight && y < gridHeight; y++) {
            const voxelIdx = z * gridSize * gridHeight + y * gridSize + x;
            voxelGrid[voxelIdx] = blockType;
            filledVoxels++;
          }
          
          // Fill water above terrain (if water depth > 0)
          if (waterDepth > 0.01) {
            const waterHeight = Math.floor(waterDepth * 256);  // Scale water height
            for (let y = terrainHeight + 1; y <= waterHeight && y < gridHeight; y++) {
              const voxelIdx = z * gridSize * gridHeight + y * gridSize + x;
              voxelGrid[voxelIdx] = 6;  // Material ID 6 = Water
              filledVoxels++;
              waterVoxels++;
            }
          }
        }
      }
    }
    
    console.log(`Filled ${filledVoxels} voxels (${(filledVoxels / voxelGrid.length * 100).toFixed(1)}% of grid)`);
    console.log(`  - Terrain: ${filledVoxels - waterVoxels} voxels`);
    console.log(`  - Water: ${waterVoxels} voxels`);
    console.log(`Max terrain height: ${maxHeight} voxels`);
    console.log(`Sample heights at corners:`, 
      `(0,0)=${Math.floor(heightData[0] * 256)}`,
      `(255,0)=${Math.floor(heightData[255 * 2] * 256)}`,
      `(0,255)=${Math.floor(heightData[255 * 2 * sourceSize] * 256)}`,
      `(255,255)=${Math.floor(heightData[255 * 2 * sourceSize + 255 * 2] * 256)}`
    );
    
    // Build SVDAG with depth 8 (2^8 = 256)
    const builder = new SVDAGBuilder(gridSize, 8);
    console.log('✅ Building 256×256×256 SVDAG (should take 5-10 seconds)...');
    
    // Use requestIdleCallback or setTimeout to yield periodically during build
    this.svdag = builder.build(voxelGrid);
    
    console.log('SVDAG compression:', this.svdag.stats.compressionRatio);
  }

  fillTestPattern(voxelGrid, gridSize, gridHeight, pattern) {
    const getIdx = (x, y, z) => z * gridSize * gridHeight + y * gridSize + x;
    
    switch(pattern) {
      case 'flat':
        // Flat ground at y=50
        for (let x = 0; x < gridSize; x++) {
          for (let z = 0; z < gridSize; z++) {
            for (let y = 0; y <= 50; y++) {
              voxelGrid[getIdx(x, y, z)] = 1;
            }
          }
        }
        break;
        
      case 'steps':
        // Stepped terrain - 8 steps across the world
        for (let x = 0; x < gridSize; x++) {
          for (let z = 0; z < gridSize; z++) {
            const height = Math.floor(x / 32) * 16 + 10; // Step every 32 voxels
            for (let y = 0; y <= height && y < gridHeight; y++) {
              voxelGrid[getIdx(x, y, z)] = 1;
            }
          }
        }
        break;
        
      case 'slope':
        // Smooth slope from y=10 to y=100
        for (let x = 0; x < gridSize; x++) {
          for (let z = 0; z < gridSize; z++) {
            const height = Math.floor(10 + (x / gridSize) * 90);
            for (let y = 0; y <= height && y < gridHeight; y++) {
              voxelGrid[getIdx(x, y, z)] = 1;
            }
          }
        }
        break;
        
      case 'checkerboard':
        // Checkerboard pattern with different heights
        for (let x = 0; x < gridSize; x++) {
          for (let z = 0; z < gridSize; z++) {
            const checker = ((Math.floor(x / 16) + Math.floor(z / 16)) % 2);
            const height = checker ? 40 : 20;
            for (let y = 0; y <= height; y++) {
              voxelGrid[getIdx(x, y, z)] = 1;
            }
          }
        }
        break;
        
      case 'pyramid':
        // Pyramid in center
        const center = gridSize / 2;
        for (let x = 0; x < gridSize; x++) {
          for (let z = 0; z < gridSize; z++) {
            const distFromCenter = Math.max(Math.abs(x - center), Math.abs(z - center));
            const height = Math.max(0, 100 - distFromCenter);
            for (let y = 0; y <= height && y < gridHeight; y++) {
              voxelGrid[getIdx(x, y, z)] = 1;
            }
          }
        }
        break;
    }
    console.log(`✅ Test pattern '${pattern}' generated`);
  }

  async createPipeline() {
    console.log('Creating SVDAG pipeline...');
    
    // Load shader
    const shaderResponse = await fetch('/shaders/raymarcher_svdag.wgsl');
    const shaderCode = await shaderResponse.text();
    
    const shaderModule = this.device.createShaderModule({
      code: shaderCode
    });
    
    // Create output texture
    this.outputTexture = this.device.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    });
    
    // Create bloom textures (quarter resolution for performance)
    const bloomWidth = Math.max(1, Math.floor(this.canvas.width / 2));
    const bloomHeight = Math.max(1, Math.floor(this.canvas.height / 2));
    
    this.bloomTexture = this.device.createTexture({
      size: [bloomWidth, bloomHeight],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    });
    
    // Create GPU buffers
    this.createBuffers();
    
    // Create compute pipeline
    this.computePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main'
      }
    });
    
    // Create bind group
    this.createBindGroup();
    
    // Create render pipeline for displaying output
    this.createRenderPipeline();
    
    console.log('Pipeline created');
  }

  createBuffers() {
    // Camera buffer (now 96 bytes = 24 floats)
    this.cameraBuffer = this.device.createBuffer({
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    
    // SVDAG params buffer
    const gridSize = 256; // High resolution (512³ uses too much RAM)
    const voxelSize = 0.666666; // 0.66m per voxel
    const worldSize = gridSize * voxelSize; // ~170 meters total (same physical world)
    
    const svdagParamsData = new Float32Array([
      this.svdag.rootIdx,
      8,  // max_depth for 256^3 (2^8 = 256)
      voxelSize,  // leaf_size (0.66m per voxel)
      this.svdag.nodesBuffer.length,
      worldSize,  // world_size (~170m)
      0, 0, 0
    ]);
    
    const nodeCount = this.svdag.nodesBuffer.length;
    const u16Limit = 65536;
    const percentUsed = (nodeCount / u16Limit * 100).toFixed(1);
    
    console.log('SVDAG Params:', {
      rootIdx: this.svdag.rootIdx,
      maxDepth: 8,
      leafSize: voxelSize,
      nodeCount: nodeCount,
      worldSize: worldSize,
      u16Status: `${nodeCount} / ${u16Limit} (${percentUsed}% used)`
    });
    
    // Warn if approaching u16 limit
    if (nodeCount > 60000) {
      console.warn(`⚠️ Node count (${nodeCount}) approaching u16 limit (${u16Limit})!`);
      console.warn('Consider switching to u32 node_idx in shader if you need larger worlds.');
    }
    
    this.svdagParamsBuffer = this.device.createBuffer({
      size: svdagParamsData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Float32Array(this.svdagParamsBuffer.getMappedRange()).set(svdagParamsData);
    this.svdagParamsBuffer.unmap();
    
    // SVDAG nodes buffer
    this.svdagNodesBuffer = this.device.createBuffer({
      size: this.svdag.nodesBuffer.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Uint32Array(this.svdagNodesBuffer.getMappedRange()).set(this.svdag.nodesBuffer);
    this.svdagNodesBuffer.unmap();
    
    // SVDAG leaves buffer
    console.log('Leaves buffer sample (first 20):', this.svdag.leavesBuffer.slice(0, 20));
    console.log('Leaves buffer non-zero count:', this.svdag.leavesBuffer.filter(x => x > 0).length);
    
    this.svdagLeavesBuffer = this.device.createBuffer({
      size: this.svdag.leavesBuffer.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Uint32Array(this.svdagLeavesBuffer.getMappedRange()).set(this.svdag.leavesBuffer);
    this.svdagLeavesBuffer.unmap();
    
    // Materials buffer - matches BlockMaterial struct in shader
    const materials = [
      { id: 0, color: [0, 0, 0], transparent: 0, emissive: 0, reflective: 0 }, // Air
      { id: 1, color: [0.27, 0.71, 0.27], transparent: 0, emissive: 0, reflective: 0 }, // Grass (green)
      { id: 2, color: [0.55, 0.35, 0.24], transparent: 0, emissive: 0, reflective: 0 }, // Dirt (brown)
      { id: 3, color: [0.5, 0.5, 0.5], transparent: 0, emissive: 0, reflective: 0 }, // Stone (gray)
      { id: 4, color: [0.93, 0.79, 0.69], transparent: 0, emissive: 0, reflective: 0 }, // Sand (tan)
      { id: 5, color: [1.0, 1.0, 1.0], transparent: 0, emissive: 0, reflective: 0.3 }, // Snow (white, reflective)
      { id: 6, color: [0.12, 0.56, 1.0], transparent: 0.8, emissive: 0, reflective: 0.2 }, // Water (blue, transparent)
    ];
    
    // BlockMaterial struct: colorR, colorG, colorB, transparent, emissive, reflective, _pad1, _pad2 (8 floats = 32 bytes)
    const materialsData = new Float32Array(materials.length * 8);
    materials.forEach((mat, i) => {
      const offset = i * 8;
      materialsData[offset + 0] = mat.color[0];  // colorR
      materialsData[offset + 1] = mat.color[1];  // colorG
      materialsData[offset + 2] = mat.color[2];  // colorB
      materialsData[offset + 3] = mat.transparent;
      materialsData[offset + 4] = mat.emissive;
      materialsData[offset + 5] = mat.reflective;
      materialsData[offset + 6] = 0;  // _pad1
      materialsData[offset + 7] = 0;  // _pad2
    });
    
    console.log('Materials loaded:', materials.length, 'types');
    
    this.materialsBuffer = this.device.createBuffer({
      size: materialsData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Float32Array(this.materialsBuffer.getMappedRange()).set(materialsData);
    this.materialsBuffer.unmap();
    
    // Time params buffer
    this.timeParamsBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    
    // Animations buffer (dummy)
    const animationsData = new Float32Array(8 * 10); // 10 animations
    this.animationsBuffer = this.device.createBuffer({
      size: animationsData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Float32Array(this.animationsBuffer.getMappedRange()).set(animationsData);
    this.animationsBuffer.unmap();
  }

  createBindGroup() {
    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer } },
        { binding: 1, resource: { buffer: this.svdagParamsBuffer } },
        { binding: 2, resource: { buffer: this.svdagNodesBuffer } },
        { binding: 3, resource: { buffer: this.svdagLeavesBuffer } },
        { binding: 4, resource: this.outputTexture.createView() },
        { binding: 5, resource: { buffer: this.materialsBuffer } }
      ]
    });
  }

  createRenderPipeline() {
    const renderShaderModule = this.device.createShaderModule({
      code: `
        @vertex
        fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
          var pos = array<vec2<f32>, 6>(
            vec2<f32>(-1.0, -1.0),
            vec2<f32>(1.0, -1.0),
            vec2<f32>(-1.0, 1.0),
            vec2<f32>(-1.0, 1.0),
            vec2<f32>(1.0, -1.0),
            vec2<f32>(1.0, 1.0)
          );
          return vec4<f32>(pos[vertexIndex], 0.0, 1.0);
        }

        @group(0) @binding(0) var outputTexture: texture_2d<f32>;
        @group(0) @binding(1) var textureSampler: sampler;
        @group(0) @binding(2) var bloomTexture: texture_2d<f32>;

        @fragment
        fn fs_main(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
          let texCoord = pos.xy / vec2<f32>(textureDimensions(outputTexture));
          var color = textureSample(outputTexture, textureSampler, texCoord).rgb;
          
          // Add bloom (if enabled, controlled by alpha channel or separate uniform)
          let bloom = textureSample(bloomTexture, textureSampler, texCoord).rgb;
          let bloomIntensity = 0.6; // Increased to make bloom more visible
          color += bloom * bloomIntensity;
          
          return vec4<f32>(color, 1.0);
        }
      `
    });

    this.renderPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: renderShaderModule,
        entryPoint: 'vs_main'
      },
      fragment: {
        module: renderShaderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: navigator.gpu.getPreferredCanvasFormat()
        }]
      },
      primitive: {
        topology: 'triangle-list'
      }
    });

    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear'
    });

    this.renderBindGroup = this.device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.outputTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.bloomTexture.createView() }
      ]
    });
    
    // Bloom pipeline - extracts bright pixels and blurs
    const bloomShaderModule = this.device.createShaderModule({
      code: `
        @group(0) @binding(0) var inputTexture: texture_2d<f32>;
        @group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
        
        @compute @workgroup_size(16, 16)
        fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
          let dims = textureDimensions(inputTexture);
          let coord = vec2<i32>(i32(globalId.x * 2u), i32(globalId.y * 2u)); // Half resolution
          
          if (coord.x >= i32(dims.x) || coord.y >= i32(dims.y)) {
            return;
          }
          
          // Sample and downsample with 2x2 box filter
          var color = vec3<f32>(0.0);
          for (var y = 0; y < 2; y++) {
            for (var x = 0; x < 2; x++) {
              let sampleCoord = coord + vec2<i32>(x, y);
              if (sampleCoord.x < i32(dims.x) && sampleCoord.y < i32(dims.y)) {
                color += textureLoad(inputTexture, sampleCoord, 0).rgb;
              }
            }
          }
          color /= 4.0;
          
          // Extract bright pixels (threshold) - lowered to catch water highlights
          let brightness = max(max(color.r, color.g), color.b);
          let threshold = 0.5;  // Lower threshold = more bloom
          let bloomColor = max(vec3<f32>(0.0), color * smoothstep(threshold, threshold + 0.3, brightness));
          
          textureStore(outputTexture, vec2<i32>(globalId.xy), vec4<f32>(bloomColor, 1.0));
        }
      `
    });
    
    this.bloomPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: bloomShaderModule,
        entryPoint: 'main'
      }
    });
    
    this.bloomBindGroup = this.device.createBindGroup({
      layout: this.bloomPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.outputTexture.createView() },
        { binding: 1, resource: this.bloomTexture.createView() }
      ]
    });
  }

  updateCamera() {
    const yaw = this.camera.rotation[0];
    const pitch = this.camera.rotation[1];
    
    // Check if camera changed
    const currentState = JSON.stringify({
      pos: this.camera.position,
      rot: this.camera.rotation,
      fov: this.camera.fov
    });
    
    if (currentState !== this.lastCameraState) {
      this.frameDirty = true;
      this.lastCameraState = currentState;
    }
    
    const forward = [
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch)
    ];
    
    const right = [
      Math.cos(yaw),
      0,
      -Math.sin(yaw)
    ];
    
    const up = [
      -Math.sin(yaw) * Math.sin(pitch),
      Math.cos(pitch),
      -Math.cos(yaw) * Math.sin(pitch)
    ];
    
    const aspect = this.canvas.width / this.canvas.height;
    
    const cameraData = new Float32Array([
      ...this.camera.position, this.camera.fov,
      ...forward, aspect,
      ...right, 0,
      ...up, 0,
      this.debugFlags.debugWaterValues ? 1.0 : 0.0,  // debug_block_id (repurposed)
      this.debugFlags.debugDAGLevels ? 1.0 : 0.0,     // debug_dag_level
      this.debugFlags.debugStepCount ? 1.0 : 0.0,     // debug_step_count
      this.epsilonScale,  // epsilon_scale (user adjustable)
      this.reverseStack ? 1.0 : 0.0,  // reverse_stack
      this.sortChildren ? 1.0 : 0.0,  // sort_children
      this.earlyExit ? 1.0 : 0.0,     // early_exit
      0.0  // _pad4
    ]);
    
    this.device.queue.writeBuffer(this.cameraBuffer, 0, cameraData);
    
    // Log once on first frame
    if (!this._loggedCamera) {
      console.log('Camera position:', this.camera.position);
      console.log('Camera forward:', forward);
      console.log('World bounds: [0, 0, 0] to [170, 170, 170] (256³ voxels @ 0.66m each)');
      this._loggedCamera = true;
    }
  }

  updateTime() {
    if (!this.pauseTime) {
      this.time += 0.016;
      
      // Mark frame dirty so it re-renders with new time
      this.frameDirty = true;
    }
    
    // Convert elapsed time to time of day (0-1 cycle)
    // Full day/night cycle every 60 seconds
    const dayNightCycleSeconds = 60.0;
    const timeOfDay = (this.time / dayNightCycleSeconds) % 1.0;
    
    const timeData = new Float32Array([
      this.time,        // time (raw, for animations)
      timeOfDay,        // timeOfDay (0-1 cycle, for sun/lighting)
      200.0,            // fogDistance (max fog distance)
      0.005             // fogDensity (not used anymore, calculated in shader)
    ]);
    this.device.queue.writeBuffer(this.timeParamsBuffer, 0, timeData);
  }

  render() {
    this.updateCamera();
    this.updateTime();
    
    // Skip rendering if nothing changed (frame caching)
    if (!this.frameDirty) {
      this.framesSaved++;
      if (this.framesSaved % 60 === 0) {
        console.log(`Frame caching: Saved ${this.framesSaved} frames`);
      }
      return;
    }
    
    // Reset dirty flag
    this.frameDirty = false;
    
    const commandEncoder = this.device.createCommandEncoder();
    
    // Compute pass - main raymarching
    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.computeBindGroup);
    computePass.dispatchWorkgroups(
      Math.ceil(this.canvas.width / 16),
      Math.ceil(this.canvas.height / 16)
    );
    computePass.end();
    
    // Bloom pass - extract and blur bright pixels
    if (this.enableBloom) {
      const bloomPass = commandEncoder.beginComputePass();
      bloomPass.setPipeline(this.bloomPipeline);
      bloomPass.setBindGroup(0, this.bloomBindGroup);
      const bloomWidth = Math.max(1, Math.floor(this.canvas.width / 2));
      const bloomHeight = Math.max(1, Math.floor(this.canvas.height / 2));
      bloomPass.dispatchWorkgroups(
        Math.ceil(bloomWidth / 16),
        Math.ceil(bloomHeight / 16)
      );
      bloomPass.end();
    }
    
    // Render pass
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },  // Black (compute shader writes everything)
        storeOp: 'store'
      }]
    });
    renderPass.setPipeline(this.renderPipeline);
    renderPass.setBindGroup(0, this.renderBindGroup);
    renderPass.draw(6);
    renderPass.end();
    
    this.device.queue.submit([commandEncoder.finish()]);
  }
  
  // Manual dirty flag setter (for lighting changes, etc.)
  markDirty() {
    this.frameDirty = true;
  }

  resize() {
    this.outputTexture.destroy();
    this.outputTexture = this.device.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    });
    
    // Recreate bloom texture
    this.bloomTexture.destroy();
    const bloomWidth = Math.max(1, Math.floor(this.canvas.width / 2));
    const bloomHeight = Math.max(1, Math.floor(this.canvas.height / 2));
    this.bloomTexture = this.device.createTexture({
      size: [bloomWidth, bloomHeight],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    });
    
    this.createBindGroup();
    this.markDirty();  // Need to rerender after resize
    
    this.renderBindGroup = this.device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.outputTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.bloomTexture.createView() }
      ]
    });
    
    this.bloomBindGroup = this.device.createBindGroup({
      layout: this.bloomPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.outputTexture.createView() },
        { binding: 1, resource: this.bloomTexture.createView() }
      ]
    });
  }
}
