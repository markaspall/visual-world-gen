/**
 * Mesh Renderer
 * 
 * High-performance triangle mesh renderer using WebGPU.
 * Renders terrain as optimized triangle meshes instead of ray marching.
 * 
 * Key Features:
 * - Hardware triangle rasterization (10-20x faster than ray marching)
 * - Smooth shading with normals
 * - Day/night cycle (same as ray marcher)
 * - Exponential fog (same algorithm)
 * - Shadow maps (future)
 */

import { GreedyMeshBuilder } from './meshBuilder.js';

export class MeshRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.device = null;
    this.context = null;
    
    // Buffers
    this.vertexBuffer = null;
    this.normalBuffer = null;
    this.colorBuffer = null;
    this.materialIdBuffer = null;
    this.indexBuffer = null;
    this.cameraBuffer = null;
    this.timeBuffer = null;
    this.materialsBuffer = null;
    
    // Shadow mapping
    this.shadowCameraBuffer = null;
    this.shadowTexture = null;
    this.shadowSampler = null;
    this.shadowPipeline = null;
    this.shadowBindGroup = null;
    
    // Pipeline
    this.pipeline = null;
    this.bindGroup = null;
    
    // Mesh data
    this.mesh = null;
    
    // Camera state (good overview position)
    this.camera = {
      // World is now 512*0.333 = ~170m wide (was 512m with stretched voxels)
      // Adjusted starting position: divide old position by 3
      position: [81.4, 33.0, 66.3], // Center of world with good view
      direction: [-2.0, -14.0],      // User's preferred viewing angle
      fov: 60,
      near: 0.1,
      far: 500.0 // Reduced far plane (world is smaller now)
    };
    
    // Time parameters
    this.startTime = performance.now() / 1000.0;
    // Start at morning (0.35 = 8:24am) for good lighting
    const startTimeOfDay = 0.35;
    this.timeParams = new Float32Array([
      0.0,            // time
      startTimeOfDay, // timeOfDay (0=midnight, 0.25=6am, 0.35=8:24am, 0.5=noon, 0.75=6pm)
      50.0,           // fogDistance (for compatibility, not used with exponential)
      0.15            // fogDensity (0 = off, 0.15 = very subtle, 0.4 = subtle, 1.2 = thick)
    ]);
    
    this.fogEnabled = true;
    
    // World data
    this.worldData = null;
    this.voxelSize = 0.333;
    
    // Surface animations (from editor)
    this.surfaceAnimations = null;
    this.animationBuffer = null;
  }

  /**
   * Initialize WebGPU and create rendering pipeline
   */
  async initialize(worldData) {
    console.log('🎨 Initializing mesh renderer...');
    
    this.worldData = worldData;
    this.voxelSize = worldData.voxelSize || 0.333;
    
    // Load surface animations from world data
    this.surfaceAnimations = worldData.animations || {};
    console.log('🌊 Surface animations:', this.surfaceAnimations);
    
    // Initialize WebGPU adapter and device
    if (!navigator.gpu) {
      throw new Error('WebGPU not supported!');
    }
    
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Failed to get WebGPU adapter!');
    }
    
    this.device = await adapter.requestDevice();
    
    // Configure canvas context
    this.context = this.canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    
    this.context.configure({
      device: this.device,
      format: format,
      alphaMode: 'opaque'
    });
    
    console.log('✅ WebGPU initialized');
    
    // Build mesh from world data
    await this.buildMesh();
    
    // Create buffers
    this.createBuffers();
    
    // Load shaders and create pipeline
    await this.createPipeline();
    
    console.log('✅ Mesh renderer ready!');
  }

  /**
   * Load PNG image and extract float data
   */
  async loadPNGData(url, normalize = false) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        // Create canvas to read pixel data
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const pixels = imageData.data;
        
        // Extract red channel as height values
        const values = new Float32Array(img.width * img.height);
        for (let i = 0; i < values.length; i++) {
          const normalized = pixels[i * 4] / 255.0; // 0-1
          if (normalize) {
            // Keep normalized for water maps
            values[i] = normalized;
          } else {
            // Convert to voxel coordinates for height maps
            values[i] = normalized * this.worldData.resolution; // 0-512 voxel coords
          }
        }
        
        console.log(`  ✅ Loaded ${url}: ${img.width}×${img.height}, ${normalize ? 'normalized 0-1' : 'heights: 0-' + this.worldData.resolution}`);
        resolve(values);
      };
      
      img.onerror = () => reject(new Error(`Failed to load ${url}`));
      img.src = url;
    });
  }

  /**
   * Load Uint8 PNG data (for block types)
   */
  async loadPNGDataUint8(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const pixels = imageData.data;
        
        // Extract red channel as block IDs
        const values = new Uint8Array(img.width * img.height);
        for (let i = 0; i < values.length; i++) {
          values[i] = pixels[i * 4]; // Red channel
        }
        
        console.log(`  ✅ Loaded ${url}: ${img.width}×${img.height}`);
        resolve(values);
      };
      
      img.onerror = () => reject(new Error(`Failed to load ${url}`));
      img.src = url;
    });
  }

  /**
   * Build triangle mesh from world data
   */
  async buildMesh() {
    console.log('🔨 Building terrain mesh...');
    console.log('  → Loading PNG data from server...');

    const resolution = this.worldData.resolution;

    // Load height map (LOD 0 - finest detail)
    const heightMapUrl = this.worldData.files.heightLOD0;
    const heightMap = await this.loadPNGData(heightMapUrl);

    // Load blocks map
    const blocksMapUrl = this.worldData.files.terrainBlocks;
    const blocksMap = await this.loadPNGDataUint8(blocksMapUrl);

    // Load water elevation map (keep normalized 0-1)
    const waterMapUrl = this.worldData.files.waterHeight;
    const waterMap = await this.loadPNGData(waterMapUrl, true); // true = keep normalized

    console.log('  → PNG data loaded (terrain + water), building mesh...');

    const meshBuilder = new GreedyMeshBuilder();

    this.mesh = meshBuilder.buildTerrainMesh(
      this.worldData,
      heightMap,
      blocksMap,
      waterMap,
      resolution
    );

    console.log('✅ Mesh ready:', this.mesh.stats);
  }

  /**
   * Create GPU buffers
{{ ... }}
   */
  createBuffers() {
    console.log('📦 Creating GPU buffers...');
    
    // Vertex buffer (positions)
    this.vertexBuffer = this.device.createBuffer({
      size: this.mesh.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Float32Array(this.vertexBuffer.getMappedRange()).set(this.mesh.vertices);
    this.vertexBuffer.unmap();
    
    // Normal buffer
    this.normalBuffer = this.device.createBuffer({
      size: this.mesh.normals.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Float32Array(this.normalBuffer.getMappedRange()).set(this.mesh.normals);
    this.normalBuffer.unmap();
    
    // Color buffer
    this.colorBuffer = this.device.createBuffer({
      size: this.mesh.colors.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Float32Array(this.colorBuffer.getMappedRange()).set(this.mesh.colors);
    this.colorBuffer.unmap();
    
    // Material ID buffer
    this.materialIdBuffer = this.device.createBuffer({
      size: this.mesh.materialIds.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Uint32Array(this.materialIdBuffer.getMappedRange()).set(this.mesh.materialIds);
    this.materialIdBuffer.unmap();
    
    // Index buffer
    this.indexBuffer = this.device.createBuffer({
      size: this.mesh.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Uint32Array(this.indexBuffer.getMappedRange()).set(this.mesh.indices);
    this.indexBuffer.unmap();
    
    // Camera uniform buffer
    this.cameraBuffer = this.device.createBuffer({
      size: 128, // View matrix (64) + projection matrix (64)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    
    // Time parameters buffer
    this.timeBuffer = this.device.createBuffer({
      size: 16, // 4 floats
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    
    // Shadow camera uniform buffer
    this.shadowCameraBuffer = this.device.createBuffer({
      size: 128, // View matrix (64) + projection matrix (64)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    
    // Shadow map texture (2048x2048 depth texture)
    this.shadowTexture = this.device.createTexture({
      size: [2048, 2048],
      format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    
    // Shadow sampler (for PCF filtering)
    this.shadowSampler = this.device.createSampler({
      compare: 'less', // Depth comparison
      magFilter: 'linear',
      minFilter: 'linear',
    });
    
    // Animation parameters buffer (frequency, amplitude, speed, phase)
    this.animationBuffer = this.device.createBuffer({
      size: 16, // 4 floats
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    
    // Pack animation data from editor (or use defaults)
    const animData = new Float32Array(4);
    
    // Find water animation (look for first animation, usually for water)
    const animIds = Object.keys(this.surfaceAnimations);
    if (animIds.length > 0) {
      const anim = this.surfaceAnimations[animIds[0]]; // Use first animation
      console.log('  → Using animation:', anim);
      
      // Map from editor parameters to shader parameters
      // Match ray marcher usage: use values directly (no arbitrary scaling!)
      // Ray marcher: waterNoise(worldPos.xz * scale, time) * strength
      // Editor: speed=0.5, scale=0.15, strength=0.08
      animData[0] = anim.scale || 0.15;    // scale (wave frequency in world space)
      animData[1] = anim.strength || 0.08; // strength (wave amplitude/height)
      animData[2] = anim.speed || 0.5;     // speed (time multiplier)
      animData[3] = 0.0;                   // phase offset
      
      console.log(`  → Wave params: scale=${animData[0]}, strength=${animData[1]}, speed=${animData[2]}`);
    } else {
      console.log('  → No animations found, using defaults');
      // Defaults if no animation defined
      animData[0] = 1.5;  // frequency
      animData[1] = 0.24; // amplitude
      animData[2] = 0.5;  // speed
      animData[3] = 0.0;  // phase
    }
    this.device.queue.writeBuffer(this.animationBuffer, 0, animData);
    
    console.log('✅ Buffers created (including shadow map & animations)');

  }

  /**
   * Create rendering pipeline with shaders
   */
  async createPipeline() {
    console.log('⚙️ Creating render pipeline...');
    
    // Load shader codes
    const [shaderResponse, shadowShaderResponse] = await Promise.all([
      fetch('/shaders/mesh_terrain.wgsl'),
      fetch('/shaders/shadow_map.wgsl')
    ]);
    const shaderCode = await shaderResponse.text();
    const shadowShaderCode = await shadowShaderResponse.text();
    
    const shaderModule = this.device.createShaderModule({
      code: shaderCode
    });
    
    const shadowShaderModule = this.device.createShaderModule({
      code: shadowShaderCode
    });
    
    // Main pipeline bind group layout (camera, time, shadow map, shadow sampler, animations)
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, // Camera
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, // Time (VERTEX added for water animation!)
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } }, // Shadow map
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } }, // Shadow sampler
        { binding: 4, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }, // Animation params
      ]
    });
    
    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout]
    });
    
    // Shadow pipeline bind group layout
    const shadowBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }, // Shadow camera
      ]
    });
    
    const shadowPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [shadowBindGroupLayout]
    });
    
    // Create render pipeline
    this.pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
        buffers: [
          {
            // Position
            arrayStride: 12, // 3 floats
            attributes: [{
              shaderLocation: 0,
              offset: 0,
              format: 'float32x3'
            }]
          },
          {
            // Normal
            arrayStride: 12, // 3 floats
            attributes: [{
              shaderLocation: 1,
              offset: 0,
              format: 'float32x3'
            }]
          },
          {
            // Color
            arrayStride: 12, // 3 floats
            attributes: [{
              shaderLocation: 2,
              offset: 0,
              format: 'float32x3'
            }]
          },
          {
            // Material ID
            arrayStride: 4, // 1 uint
            attributes: [{
              shaderLocation: 3,
              offset: 0,
              format: 'uint32'
            }]
          }
        ]
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [{
          format: navigator.gpu.getPreferredCanvasFormat(),
          // Enable alpha blending for water transparency
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add'
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add'
            }
          }
        }]
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none', // Disable culling to see all faces (debug)
        frontFace: 'ccw'
      },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus'
      }
    });
    
    // Create depth texture
    this.depthTexture = this.device.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    
    // Create shadow pipeline (depth-only rendering)
    this.shadowPipeline = this.device.createRenderPipeline({
      layout: shadowPipelineLayout,
      vertex: {
        module: shadowShaderModule,
        entryPoint: 'vertexMain',
        buffers: [
          {
            // Position only for shadow mapping
            arrayStride: 12, // 3 floats
            attributes: [{
              shaderLocation: 0,
              offset: 0,
              format: 'float32x3'
            }]
          }
        ]
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back', // Cull back faces for shadow mapping
        frontFace: 'ccw'
      },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth32float' // Match shadow texture format
      }
    });
    
    // Create bind groups
    this.bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer } },
        { binding: 1, resource: { buffer: this.timeBuffer } },
        { binding: 2, resource: this.shadowTexture.createView() },
        { binding: 3, resource: this.shadowSampler },
        { binding: 4, resource: { buffer: this.animationBuffer } }
      ]
    });
    
    this.shadowBindGroup = this.device.createBindGroup({
      layout: shadowBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.shadowCameraBuffer } }
      ]
    });
    
    console.log('✅ Pipeline created (with shadow mapping)');
  }

  /**
   * Calculate shadow camera matrix (orthographic from sun's POV)
   */
  updateShadowCamera(sunDir) {
    // Shadow camera looks from sun toward world center
    // World is 512 voxels * 0.333 = 170.4m, center at 85.2m
    const worldCenter = [85.2, 30, 85.2]; // Center of world (adjusted for voxelSize)
    const shadowDistance = 120; // How far from center to place sun (reduced for smaller world)
    
    // Sun position (opposite of sun direction)
    const sunPos = [
      worldCenter[0] - sunDir[0] * shadowDistance,
      worldCenter[1] - sunDir[1] * shadowDistance,
      worldCenter[2] - sunDir[2] * shadowDistance
    ];
    
    const up = [0, 1, 0];
    const shadowView = this.lookAt(sunPos, worldCenter, up);
    
    // Orthographic projection covering entire world (170x170m with voxelSize=0.333)
    const shadowProjection = this.orthographic(-100, 100, -100, 100, 0.1, 200);
    
    // Pack into buffer
    const shadowCameraData = new Float32Array(32);
    shadowCameraData.set(shadowView, 0);
    shadowCameraData.set(shadowProjection, 16);
    
    this.device.queue.writeBuffer(this.shadowCameraBuffer, 0, shadowCameraData);
  }

  /**
   * Update camera matrices
   */
  updateCamera() {
    const aspect = this.canvas.width / this.canvas.height;
    
    // Calculate view matrix from camera position and direction
    const yaw = this.camera.direction[0] * Math.PI / 180;
    const pitch = this.camera.direction[1] * Math.PI / 180;
    
    const forward = [
      Math.cos(pitch) * Math.sin(yaw),
      Math.sin(pitch),
      Math.cos(pitch) * Math.cos(yaw)
    ];
    
    const target = [
      this.camera.position[0] + forward[0],
      this.camera.position[1] + forward[1],
      this.camera.position[2] + forward[2]
    ];
    
    const up = [0, 1, 0];
    
    const viewMatrix = this.lookAt(this.camera.position, target, up);
    const projectionMatrix = this.perspective(this.camera.fov * Math.PI / 180, aspect, this.camera.near, this.camera.far);
    
    // Pack into buffer (view + projection = 32 floats)
    const cameraData = new Float32Array(32);
    cameraData.set(viewMatrix, 0);
    cameraData.set(projectionMatrix, 16);
    
    this.device.queue.writeBuffer(this.cameraBuffer, 0, cameraData);
  }

  /**
   * Toggle fog on/off
   */
  setFogEnabled(enabled) {
    this.fogEnabled = enabled;
    this.timeParams[3] = enabled ? 0.15 : 0.0; // Set fog density (0.15 = very subtle)
  }

  /**
   * Render a frame
   */
  render() {
    // Update time parameters
    const currentTime = performance.now() / 1000.0 - this.startTime;
    this.timeParams[0] = currentTime;
    // 2-minute day/night cycle starting from morning (0.35)
    this.timeParams[1] = (0.35 + currentTime / 120.0) % 1.0;
    this.timeParams[3] = this.fogEnabled ? 0.15 : 0.0; // Update fog density (0.15 = very subtle)
    this.device.queue.writeBuffer(this.timeBuffer, 0, this.timeParams);
    
    // Calculate sun direction from time of day
    const timeOfDay = this.timeParams[1];
    const angle = timeOfDay * 2.0 * Math.PI;
    const sunDir = [
      Math.cos(angle),
      Math.sin(angle),
      0.3
    ];
    const len = Math.sqrt(sunDir[0] * sunDir[0] + sunDir[1] * sunDir[1] + sunDir[2] * sunDir[2]);
    sunDir[0] /= len;
    sunDir[1] /= len;
    sunDir[2] /= len;
    
    // Update shadow camera
    this.updateShadowCamera(sunDir);
    
    // Update main camera
    this.updateCamera();
    
    const commandEncoder = this.device.createCommandEncoder();
    
    // ===================================
    // PASS 1: Render shadow map
    // ===================================
    const shadowPass = commandEncoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: this.shadowTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store'
      }
    });
    
    shadowPass.setPipeline(this.shadowPipeline);
    shadowPass.setBindGroup(0, this.shadowBindGroup);
    
    // Only need position buffer for shadow mapping
    shadowPass.setVertexBuffer(0, this.vertexBuffer);
    shadowPass.setIndexBuffer(this.indexBuffer, 'uint32');
    shadowPass.drawIndexed(this.mesh.indices.length);
    
    shadowPass.end();
    
    // ===================================
    // PASS 2: Render main scene with shadows
    // ===================================
    // Calculate sky color based on time of day
    const sunElevation = sunDir[1];
    let skyColor;
    if (sunElevation > 0.3) {
      // Day - bright blue sky
      skyColor = { r: 0.53, g: 0.81, b: 0.92, a: 1.0 };
    } else if (sunElevation > -0.1) {
      // Sunset/sunrise - orange/pink
      const t = (sunElevation + 0.1) / 0.4;
      skyColor = {
        r: 0.9 * (1 - t) + 0.53 * t,
        g: 0.5 * (1 - t) + 0.81 * t,
        b: 0.3 * (1 - t) + 0.92 * t,
        a: 1.0
      };
    } else {
      // Night - dark blue/black with stars
      const t = Math.max(0, (sunElevation + 0.3) / 0.2);
      skyColor = {
        r: 0.02 + t * 0.1,
        g: 0.02 + t * 0.15,
        b: 0.05 + t * 0.2,
        a: 1.0
      };
    }
    
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: skyColor,
        loadOp: 'clear',
        storeOp: 'store'
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store'
      }
    });
    
    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    
    // Set all vertex buffers
    renderPass.setVertexBuffer(0, this.vertexBuffer);
    renderPass.setVertexBuffer(1, this.normalBuffer);
    renderPass.setVertexBuffer(2, this.colorBuffer);
    renderPass.setVertexBuffer(3, this.materialIdBuffer);
    
    // Draw indexed
    renderPass.setIndexBuffer(this.indexBuffer, 'uint32');
    renderPass.drawIndexed(this.mesh.indices.length);
    
    renderPass.end();
    
    this.device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Matrix math helpers
   */
  lookAt(eye, target, up) {
    const z = this.normalize(this.subtract(eye, target));
    const x = this.normalize(this.cross(up, z));
    const y = this.cross(z, x);
    
    return new Float32Array([
      x[0], x[1], x[2], 0,
      y[0], y[1], y[2], 0,
      z[0], z[1], z[2], 0,
      -this.dot(x, eye), -this.dot(y, eye), -this.dot(z, eye), 1
    ]);
  }

  perspective(fovy, aspect, near, far) {
    const f = 1.0 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ]);
  }

  orthographic(left, right, bottom, top, near, far) {
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    const nf = 1 / (near - far);
    
    return new Float32Array([
      -2 * lr, 0, 0, 0,
      0, -2 * bt, 0, 0,
      0, 0, 2 * nf, 0,
      (left + right) * lr, (top + bottom) * bt, (far + near) * nf, 1
    ]);
  }

  normalize(v) {
    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    return [v[0] / len, v[1] / len, v[2] / len];
  }

  subtract(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }

  cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  /**
   * Handle canvas resize
   */
  resize() {
    this.depthTexture = this.device.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
  }
}
