/**
 * World Renderer - Ray marching 3D world viewer
 */
export class WorldRenderer {
  constructor(canvas, worldData) {
    this.canvas = canvas;
    this.worldData = worldData;
    this.running = false;
    this.fps = 0;
    
    // Camera state (positioned to view terrain)
    // World is 512x256x512 voxels = 170.67m x 85.33m x 170.67m (at 0.333m/voxel)
    // Terrain builds from Y=0 upward
    this.camera = {
      position: [85, 30, 85], // Center of world, 30m up (above typical terrain)
      rotation: [0, 0], // [yaw, pitch] in radians, looking forward
      fov: 75 * Math.PI / 180,
      speed: 20.0, // m/s
      mouseSensitivity: 0.002
    };
    
    // Input state
    this.keys = {};
    this.mouseMovement = [0, 0];
    this.pointerLocked = false;
    
    // Debug toggles
    this.debugFlags = {
      showTerrain: true,
      showWater: true,
      debugWaterValues: false,
      useLOD: false,  // Start with DDA for debugging
      debugLODLevels: false,
      debugStepCount: false,
      debugDistance: false,
      debugNormals: false
    };
    
    this.setupInput();
    this.setupDebugUI();
  }

  async init() {
    console.log('Initializing world renderer...');
    
    // Resize canvas to window
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    
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
    
    // Prepare world data for GPU
    await this.prepareWorldData();
    
    // Create ray marching pipeline
    await this.createPipeline();
    
    console.log('World renderer initialized');
  }

  resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    
    // Recreate output texture if pipeline exists
    if (this.outputTexture) {
      this.outputTexture.destroy();
      this.outputTexture = this.device.createTexture({
        size: [this.canvas.width, this.canvas.height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
      });
      
      // Recreate bind groups with new texture
      this.computeBindGroup = this.device.createBindGroup({
        layout: this.computePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.cameraBuffer } },
          { binding: 2, resource: { buffer: this.heightBuffers.lod0 } },
          { binding: 3, resource: this.outputTexture.createView() },
          { binding: 4, resource: { buffer: this.blocksBuffer } },
          { binding: 5, resource: { buffer: this.waterBuffer } },
        ]
      });
      
      this.blitBindGroup = this.device.createBindGroup({
        layout: this.blitPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.outputTexture.createView() },
          { binding: 1, resource: this.sampler },
        ]
      });
    }
  }

  async prepareWorldData() {
    const { files, maps, resolution, blocks } = this.worldData;
    
    // Load block definitions
    this.blockDefinitions = blocks || [
      { id: 0, name: 'Air', color: '#000000', transparent: 1.0, emissive: 0.0, reflective: 0.0, refractive: 1.0 },
      { id: 1, name: 'Grass', color: '#45b545', transparent: 0.0, emissive: 0.0, reflective: 0.0, refractive: 1.0 },
      { id: 2, name: 'Dirt', color: '#8b5a3c', transparent: 0.0, emissive: 0.0, reflective: 0.0, refractive: 1.0 },
      { id: 3, name: 'Stone', color: '#808080', transparent: 0.0, emissive: 0.0, reflective: 0.0, refractive: 1.0 },
      { id: 4, name: 'Sand', color: '#edc9af', transparent: 0.0, emissive: 0.0, reflective: 0.0, refractive: 1.0 },
      { id: 5, name: 'Snow', color: '#ffffff', transparent: 0.0, emissive: 0.0, reflective: 0.3, refractive: 1.0 },
      { id: 6, name: 'Water', color: '#1e90ff', transparent: 0.8, emissive: 0.0, reflective: 0.2, refractive: 1.33 },
    ];
    console.log('Loaded block definitions:', this.blockDefinitions.length, 'blocks');
    
    // Check if using new PNG-based format
    if (files) {
      console.log('Loading PNG-based world data from server...');
      
      // Load heightmap LODs from PNG (server URLs are already absolute paths)
      this.heightLOD = {};
      for (const [key, url] of Object.entries(files)) {
        if (key.startsWith('heightLOD')) {
          // Extract LOD number: heightLOD0 → 0 → lod0
          const lodNumber = key.replace('heightLOD', '');
          const lodLevel = `lod${lodNumber}`;
          console.log(`Loading ${key} → ${lodLevel} from ${url}`);
          const data = await this.loadPNGAsFloatArray(url);
          this.heightLOD[lodLevel] = data;
          console.log(`✅ Loaded ${lodLevel}: ${data.length} values`);
        }
      }
      
      // Load water height map from PNG
      if (files.waterHeight) {
        this.waterMap = await this.loadPNGAsFloatArray(files.waterHeight);
        console.log(`Loaded water height: ${this.waterMap.length} values`);
      } else {
        this.waterMap = new Float32Array(512 * 512).fill(0);
      }
      
      // Load terrain blocks map from PNG
      if (files.terrainBlocks) {
        this.blocksMap = await this.loadPNGAsUintArray(files.terrainBlocks);
        console.log(`Loaded terrain blocks: ${this.blocksMap.length} values`);
      } else {
        this.blocksMap = new Uint32Array(512 * 512).fill(1);
      }
      
      this.resolution = {
        lod0: 512,
        lod1: 128,
        lod2: 32,
        lod3: 8
      };
    } else {
      // Legacy JSON-based format
      console.log('Loading JSON-based world data (legacy)...');
      
      this.heightLOD = {
        lod0: new Float32Array(maps.heightLOD.lod0.data),
        lod1: new Float32Array(maps.heightLOD.lod1.data),
        lod2: new Float32Array(maps.heightLOD.lod2.data),
        lod3: new Float32Array(maps.heightLOD.lod3.data)
      };
      
      this.blocksMap = maps.terrainBlocks?.data ? new Uint32Array(maps.terrainBlocks.data) : new Uint32Array(512 * 512).fill(1);
      this.waterMap = maps.waterElevation?.data ? new Float32Array(maps.waterElevation.data) : new Float32Array(512 * 512).fill(0);
      
      this.resolution = {
        lod0: maps.heightLOD.lod0.resolution,
        lod1: maps.heightLOD.lod1.resolution,
        lod2: maps.heightLOD.lod2.resolution,
        lod3: maps.heightLOD.lod3.resolution
      };
    }
    
    console.log('✅ World data prepared:', {
      resolution: this.resolution,
      lodKeys: Object.keys(this.heightLOD),
      lod0Size: this.heightLOD.lod0?.length,
      lod1Size: this.heightLOD.lod1?.length,
      lod2Size: this.heightLOD.lod2?.length,
      lod3Size: this.heightLOD.lod3?.length,
      blocksSize: this.blocksMap?.length,
      waterSize: this.waterMap?.length
    });
  }

  async loadPNGAsFloatArray(url) {
    const img = await this.loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, img.width, img.height);
    
    // Convert R channel (0-255) back to float (0.0-1.0)
    const data = new Float32Array(img.width * img.height);
    for (let i = 0; i < data.length; i++) {
      data[i] = imageData.data[i * 4] / 255.0; // R channel
    }
    return data;
  }

  async loadPNGAsUintArray(url) {
    const img = await this.loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, img.width, img.height);
    
    // Extract R channel as uint values
    const data = new Uint32Array(img.width * img.height);
    for (let i = 0; i < data.length; i++) {
      data[i] = imageData.data[i * 4]; // R channel
    }
    return data;
  }

  async loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        console.log(`✅ Loaded image: ${url} (${img.width}×${img.height})`);
        resolve(img);
      };
      img.onerror = (e) => {
        console.error(`❌ Failed to load image: ${url}`, e);
        reject(new Error(`Failed to load image: ${url}`));
      };
      img.src = url;
      console.log(`📥 Loading image: ${url}`);
    });
  }

  async createPipeline() {
    // Load compute shader (TEST VERSION)
    const computeCode = await fetch('/shaders/raymarcher_test.wgsl').then(r => r.text());
    const computeModule = this.device.createShaderModule({ code: computeCode });
    
    // Load blit shader
    const blitCode = await fetch('/shaders/blit.wgsl').then(r => r.text());
    const blitModule = this.device.createShaderModule({ code: blitCode });
    
    // Create compute pipeline
    this.computePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: computeModule,
        entryPoint: 'main'
      }
    });
    
    // Create blit render pipeline
    this.blitPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: blitModule,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: blitModule,
        entryPoint: 'fragmentMain',
        targets: [{
          format: navigator.gpu.getPreferredCanvasFormat()
        }]
      },
      primitive: {
        topology: 'triangle-list'
      }
    });
    
    // Create output texture
    this.outputTexture = this.device.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    });
    
    // Create sampler for blit
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear'
    });
    
    // Create buffers for world data
    await this.createWorldBuffers();
  }

  async createWorldBuffers() {
    // Validate that all data was loaded
    console.log('Creating world buffers...');
    console.log('Height LOD keys:', Object.keys(this.heightLOD));
    console.log('Blocks map size:', this.blocksMap?.length);
    console.log('Water map size:', this.waterMap?.length);
    
    if (!this.heightLOD.lod0 || !this.heightLOD.lod1 || !this.heightLOD.lod2 || !this.heightLOD.lod3) {
      throw new Error('Missing height LOD data! Check if PNGs loaded correctly.');
    }
    if (!this.blocksMap) {
      throw new Error('Missing terrain blocks data!');
    }
    if (!this.waterMap) {
      throw new Error('Missing water map data!');
    }
    
    // Camera uniform buffer (added debug flags)
    this.cameraBuffer = this.device.createBuffer({
      size: 96, // 6x vec4 (camera + debug flags)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    
    // Time parameters buffer for atmospheric effects
    this.timeBuffer = this.device.createBuffer({
      size: 16, // 4 floats: time, timeOfDay, fogDistance, fogDensity
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    
    // Initialize time parameters
    this.startTime = performance.now() / 1000.0;
    this.timeParams = new Float32Array([
      0.0,   // time (updated each frame)
      0.25,  // timeOfDay (0=midnight, 0.25=sunrise, 0.5=noon, 0.75=sunset) - animated!
      50.0,  // fogDistance (not used with exponential fog, kept for compatibility)
      1.2    // fogDensity (exponential fog strength - higher = thicker)
    ]);
    
    // Height LOD buffers
    this.heightBuffers = {};
    for (const [lod, data] of Object.entries(this.heightLOD)) {
      console.log(`Creating buffer for ${lod}: ${data.byteLength} bytes`);
      this.heightBuffers[lod] = this.device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      });
      this.device.queue.writeBuffer(this.heightBuffers[lod], 0, data);
    }
    
    // Blocks buffer (512x512 u32)
    this.blocksBuffer = this.device.createBuffer({
      size: this.blocksMap.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(this.blocksBuffer, 0, this.blocksMap);
    
    // Water buffer (512x512 f32)
    this.waterBuffer = this.device.createBuffer({
      size: this.waterMap.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(this.waterBuffer, 0, this.waterMap);
    
    // World params buffer
    const paramsData = new Uint32Array([
      this.resolution.lod0,
      this.resolution.lod1,
      this.resolution.lod2,
      this.resolution.lod3
    ]);
    
    this.paramsBuffer = this.device.createBuffer({
      size: paramsData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);
    
    // Build animation lookup map (animationId string -> array index)
    const animations = this.worldData.animations || {};
    const animationList = [];
    const animationIdMap = {}; // Maps node ID to array index
    
    Object.entries(animations).forEach(([nodeId, animData], index) => {
      animationList.push(animData);
      animationIdMap[nodeId] = index;
    });
    
    console.log(`Loaded ${animationList.length} animations:`, animationList);
    
    // Block materials buffer
    // Structure: [id, colorR, colorG, colorB, transparent, emissive, reflective, refractive, animationId] per block
    const materialsData = new Float32Array(this.blockDefinitions.length * 12); // 12 floats per block (3 vec4s)
    this.blockDefinitions.forEach((block, i) => {
      const offset = i * 12;
      materialsData[offset] = block.id;
      
      // Parse hex color to RGB
      const color = this.hexToRgb(block.color);
      materialsData[offset + 1] = color.r / 255;
      materialsData[offset + 2] = color.g / 255;
      materialsData[offset + 3] = color.b / 255;
      
      materialsData[offset + 4] = block.transparent || 0;
      materialsData[offset + 5] = block.emissive || 0;
      materialsData[offset + 6] = block.reflective || 0;
      materialsData[offset + 7] = block.refractive || 1.0;
      
      // Animation ID (convert node ID to array index, or -1 for none)
      const animIndex = block.animationId ? (animationIdMap[block.animationId] ?? -1) : -1;
      materialsData[offset + 8] = animIndex;
      materialsData[offset + 9] = 0; // padding
      materialsData[offset + 10] = 0; // padding
      materialsData[offset + 11] = 0; // padding
      
      console.log(`Material ${i} (ID ${block.id}): ${block.name}, animationId=${animIndex}`);
    });
    
    this.materialsBuffer = this.device.createBuffer({
      size: materialsData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(this.materialsBuffer, 0, materialsData);
    console.log(`Created materials buffer: ${this.blockDefinitions.length} blocks`);
    
    // Animations buffer
    // Structure per animation: [type, speed, scale, strength, octaves, dirX, dirY, padding] (8 floats = 2 vec4s)
    const animationsData = new Float32Array(Math.max(animationList.length, 1) * 8); // At least 1 to avoid empty buffer
    animationList.forEach((anim, i) => {
      const offset = i * 8;
      // Map type string to number
      const typeMap = { 'ripples': 0, 'flow': 1, 'sway': 2, 'shimmer': 3 };
      animationsData[offset] = typeMap[anim.type] || 0;
      animationsData[offset + 1] = anim.speed || 0.5;
      animationsData[offset + 2] = anim.scale || 0.15;
      animationsData[offset + 3] = anim.strength || 0.08;
      animationsData[offset + 4] = anim.octaves || 3;
      animationsData[offset + 5] = anim.direction[0] || 1.0;
      animationsData[offset + 6] = anim.direction[1] || 0.0;
      animationsData[offset + 7] = 0; // padding
      
      console.log(`Animation ${i}: type=${anim.type}, speed=${anim.speed}, scale=${anim.scale}`);
    });
    
    this.animationsBuffer = this.device.createBuffer({
      size: animationsData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(this.animationsBuffer, 0, animationsData);
    console.log(`Created animations buffer: ${animationList.length} animations`);
    
    // Create compute bind group (camera, params, LODs, output, blocks, water, materials, time, animations)
    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer } },
        { binding: 1, resource: { buffer: this.paramsBuffer } },
        { binding: 2, resource: { buffer: this.heightBuffers.lod0 } },
        { binding: 3, resource: { buffer: this.heightBuffers.lod1 } },
        { binding: 4, resource: { buffer: this.heightBuffers.lod2 } },
        { binding: 5, resource: { buffer: this.heightBuffers.lod3 } },
        { binding: 6, resource: this.outputTexture.createView() },
        { binding: 7, resource: { buffer: this.blocksBuffer } },
        { binding: 8, resource: { buffer: this.waterBuffer } },
        { binding: 9, resource: { buffer: this.materialsBuffer } },
        { binding: 10, resource: { buffer: this.timeBuffer } },
        { binding: 11, resource: { buffer: this.animationsBuffer } },
      ]
    });
    
    // Create blit bind group
    this.blitBindGroup = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.outputTexture.createView() },
        { binding: 1, resource: this.sampler },
      ]
    });
  }

  setupInput() {
    // Keyboard
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Escape') {
        document.exitPointerLock();
      }
      // Debug toggles
      if (e.code === 'Digit8') {
        this.debugFlags.showTerrain = !this.debugFlags.showTerrain;
        document.getElementById('toggleTerrain').checked = this.debugFlags.showTerrain;
        console.log('Terrain:', this.debugFlags.showTerrain ? 'ON' : 'OFF');
      }
      if (e.code === 'Digit9') {
        this.debugFlags.showWater = !this.debugFlags.showWater;
        document.getElementById('toggleWater').checked = this.debugFlags.showWater;
        console.log('Water:', this.debugFlags.showWater ? 'ON' : 'OFF');
      }
      if (e.code === 'Digit0') {
        this.debugFlags.debugWaterValues = !this.debugFlags.debugWaterValues;
        document.getElementById('toggleDebugWater').checked = this.debugFlags.debugWaterValues;
        console.log('Debug Water Values:', this.debugFlags.debugWaterValues ? 'ON' : 'OFF');
      }
      if (e.code === 'KeyL') {
        this.debugFlags.useLOD = !this.debugFlags.useLOD;
        document.getElementById('toggleLOD').checked = this.debugFlags.useLOD;
        console.log('LOD Ray Marching:', this.debugFlags.useLOD ? 'ON' : 'OFF');
      }
      if (e.code === 'KeyK') {
        this.debugFlags.debugLODLevels = !this.debugFlags.debugLODLevels;
        document.getElementById('toggleDebugLOD').checked = this.debugFlags.debugLODLevels;
        console.log('Debug LOD Levels:', this.debugFlags.debugLODLevels ? 'ON' : 'OFF');
      }
      if (e.code === 'KeyJ') {
        this.debugFlags.debugStepCount = !this.debugFlags.debugStepCount;
        document.getElementById('toggleStepCount').checked = this.debugFlags.debugStepCount;
        console.log('Step Count Heatmap:', this.debugFlags.debugStepCount ? 'ON' : 'OFF');
      }
      if (e.code === 'KeyH') {
        this.debugFlags.debugDistance = !this.debugFlags.debugDistance;
        document.getElementById('toggleDistance').checked = this.debugFlags.debugDistance;
        console.log('Distance Heatmap:', this.debugFlags.debugDistance ? 'ON' : 'OFF');
      }
      if (e.code === 'KeyN') {
        this.debugFlags.debugNormals = !this.debugFlags.debugNormals;
        document.getElementById('toggleNormals').checked = this.debugFlags.debugNormals;
        console.log('Debug Normals:', this.debugFlags.debugNormals ? 'ON' : 'OFF');
      }
    });
    
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
    
    // Mouse
    this.canvas.addEventListener('click', () => {
      this.canvas.requestPointerLock();
    });
    
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
    
    document.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.mouseMovement[0] += e.movementX;
        this.mouseMovement[1] += e.movementY;
      }
    });
  }

  setupDebugUI() {
    // Create debug panel
    const debugPanel = document.createElement('div');
    debugPanel.style.cssText = `
      position: fixed;
      top: 120px;
      left: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 10px;
      border-radius: 5px;
      font-family: monospace;
      font-size: 12px;
      z-index: 1000;
    `;
    debugPanel.innerHTML = `
      <div style="margin-bottom: 5px; font-weight: bold;">🎨 Debug Toggles</div>
      <label style="display: block; margin: 5px 0;">
        <input type="checkbox" id="toggleTerrain" checked> [8] Terrain
      </label>
      <label style="display: block; margin: 5px 0;">
        <input type="checkbox" id="toggleWater" checked> [9] Water
      </label>
      <label style="display: block; margin: 5px 0;">
        <input type="checkbox" id="toggleDebugWater"> [0] Debug Water Map
      </label>
      <label style="display: block; margin: 5px 0;">
        <input type="checkbox" id="toggleLOD"> [L] LOD Ray Marching
      </label>
      <label style="display: block; margin: 5px 0;">
        <input type="checkbox" id="toggleDebugLOD"> [K] Debug LOD Levels
      </label>
      <hr style="margin: 10px 0; border-color: #444;">
      <div style="margin-bottom: 5px; font-weight: bold;">📊 Performance Heatmaps</div>
      <label style="display: block; margin: 5px 0;">
        <input type="checkbox" id="toggleStepCount"> [J] Step Count Heatmap
      </label>
      <label style="display: block; margin: 5px 0;">
        <input type="checkbox" id="toggleDistance"> [H] Distance Heatmap
      </label>
      <label style="display: block; margin: 5px 0;">
        <input type="checkbox" id="toggleNormals"> [N] Debug Normals
      </label>
    `;
    document.body.appendChild(debugPanel);
    
    // Hook up checkboxes
    document.getElementById('toggleTerrain').addEventListener('change', (e) => {
      this.debugFlags.showTerrain = e.target.checked;
    });
    document.getElementById('toggleWater').addEventListener('change', (e) => {
      this.debugFlags.showWater = e.target.checked;
    });
    document.getElementById('toggleDebugWater').addEventListener('change', (e) => {
      this.debugFlags.debugWaterValues = e.target.checked;
    });
    document.getElementById('toggleLOD').addEventListener('change', (e) => {
      this.debugFlags.useLOD = e.target.checked;
      console.log('LOD Ray Marching:', e.target.checked ? 'ON' : 'OFF');
    });
    document.getElementById('toggleDebugLOD').addEventListener('change', (e) => {
      this.debugFlags.debugLODLevels = e.target.checked;
      console.log('Debug LOD Levels:', e.target.checked ? 'ON' : 'OFF');
    });
    document.getElementById('toggleStepCount').addEventListener('change', (e) => {
      this.debugFlags.debugStepCount = e.target.checked;
      console.log('Step Count Heatmap:', e.target.checked ? 'ON' : 'OFF');
    });
    document.getElementById('toggleDistance').addEventListener('change', (e) => {
      this.debugFlags.debugDistance = e.target.checked;
      console.log('Distance Heatmap:', e.target.checked ? 'ON' : 'OFF');
    });
    document.getElementById('toggleNormals').addEventListener('change', (e) => {
      this.debugFlags.debugNormals = e.target.checked;
      console.log('Debug Normals:', e.target.checked ? 'ON' : 'OFF');
    });
  }

  updateCamera(deltaTime) {
    // Mouse look
    if (this.pointerLocked) {
      this.camera.rotation[0] -= this.mouseMovement[0] * this.camera.mouseSensitivity;
      this.camera.rotation[1] -= this.mouseMovement[1] * this.camera.mouseSensitivity;
      this.camera.rotation[1] = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.camera.rotation[1]));
      this.mouseMovement = [0, 0];
    }
    
    // Movement
    const forward = [
      Math.sin(this.camera.rotation[0]),
      0,
      Math.cos(this.camera.rotation[0])
    ];
    const right = [
      Math.cos(this.camera.rotation[0]),
      0,
      -Math.sin(this.camera.rotation[0])
    ];
    
    const velocity = [0, 0, 0];
    const speed = this.camera.speed * deltaTime;
    
    if (this.keys['KeyW']) {
      velocity[0] += forward[0] * speed;
      velocity[2] += forward[2] * speed;
    }
    if (this.keys['KeyS']) {
      velocity[0] -= forward[0] * speed;
      velocity[2] -= forward[2] * speed;
    }
    if (this.keys['KeyA']) {
      velocity[0] -= right[0] * speed;
      velocity[2] -= right[2] * speed;
    }
    if (this.keys['KeyD']) {
      velocity[0] += right[0] * speed;
      velocity[2] += right[2] * speed;
    }
    if (this.keys['Space']) {
      velocity[1] += speed;
    }
    if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) {
      velocity[1] -= speed;
    }
    
    this.camera.position[0] += velocity[0];
    this.camera.position[1] += velocity[1];
    this.camera.position[2] += velocity[2];
    
    // Update camera buffer
    this.updateCameraBuffer();
  }

  updateCameraBuffer() {
    // Pack camera data: position, forward, right, up, aspect
    const yaw = this.camera.rotation[0];
    const pitch = this.camera.rotation[1];
    
    const forward = [
      Math.sin(yaw) * Math.cos(pitch),
      -Math.sin(pitch), // Negative for standard FPS camera
      Math.cos(yaw) * Math.cos(pitch)
    ];
    
    const right = [
      Math.cos(yaw),
      0,
      -Math.sin(yaw)
    ];
    
    const up = [
      forward[1] * right[2] - forward[2] * right[1],
      forward[2] * right[0] - forward[0] * right[2],
      forward[0] * right[1] - forward[1] * right[0]
    ];
    
    const aspect = this.canvas.width / this.canvas.height;
    
    const cameraData = new Float32Array([
      ...this.camera.position, this.camera.fov,
      ...forward, aspect,
      ...right, 0,
      ...up, 0,
      this.debugFlags.showTerrain ? 1.0 : 0.0,
      this.debugFlags.showWater ? 1.0 : 0.0,
      this.debugFlags.debugWaterValues ? 1.0 : 0.0,
      this.debugFlags.useLOD ? 1.0 : 0.0,
      this.debugFlags.debugLODLevels ? 1.0 : 0.0,
      this.debugFlags.debugStepCount ? 1.0 : 0.0,
      this.debugFlags.debugDistance ? 1.0 : 0.0,
      this.debugFlags.debugNormals ? 1.0 : 0.0
    ]);
    
    this.device.queue.writeBuffer(this.cameraBuffer, 0, cameraData);
  }

  render() {
    // Update time parameters for animated effects
    const currentTime = performance.now() / 1000.0 - this.startTime;
    this.timeParams[0] = currentTime;
    
    // Animate day/night cycle (full cycle every 120 seconds = 2 minutes)
    const dayNightCycleSpeed = 1.0 / 120.0; // Complete cycle in 120 seconds
    this.timeParams[1] = (currentTime * dayNightCycleSpeed) % 1.0;
    
    this.device.queue.writeBuffer(this.timeBuffer, 0, this.timeParams);
    
    const encoder = this.device.createCommandEncoder();
    
    // Compute pass: ray march to output texture
    const computePass = encoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.computeBindGroup);
    computePass.dispatchWorkgroups(
      Math.ceil(this.canvas.width / 8),
      Math.ceil(this.canvas.height / 8)
    );
    computePass.end();
    
    // Render pass: blit texture to canvas
    const textureView = this.context.getCurrentTexture().createView();
    
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });
    
    renderPass.setPipeline(this.blitPipeline);
    renderPass.setBindGroup(0, this.blitBindGroup);
    renderPass.draw(6, 1, 0, 0); // Fullscreen quad
    renderPass.end();
    
    this.device.queue.submit([encoder.finish()]);
  }

  start() {
    this.running = true;
    let lastTime = performance.now();
    let frameCount = 0;
    let fpsTime = 0;
    
    const frame = () => {
      if (!this.running) return;
      
      const now = performance.now();
      const deltaTime = (now - lastTime) / 1000;
      lastTime = now;
      
      // FPS counter
      frameCount++;
      fpsTime += deltaTime;
      if (fpsTime >= 1.0) {
        this.fps = frameCount / fpsTime;
        frameCount = 0;
        fpsTime = 0;
      }
      
      // Update
      this.updateCamera(deltaTime);
      
      // Render
      this.render();
      
      requestAnimationFrame(frame);
    };
    
    frame();
  }

  stop() {
    this.running = false;
  }

  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  }
}
