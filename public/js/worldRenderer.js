/**
 * World Renderer - Ray marching 3D world viewer
 */
export class WorldRenderer {
  constructor(canvas, worldData) {
    this.canvas = canvas;
    this.worldData = worldData;
    this.running = false;
    this.fps = 0;
    
    // Camera state
    this.camera = {
      position: [256, 100, 256], // Start in center, 100m up
      rotation: [0, 0], // [yaw, pitch] in radians
      fov: 75 * Math.PI / 180,
      speed: 20.0, // m/s
      mouseSensitivity: 0.002
    };
    
    // Input state
    this.keys = {};
    this.mouseMovement = [0, 0];
    this.pointerLocked = false;
    
    this.setupInput();
  }

  async init() {
    console.log('Initializing world renderer...');
    
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

  async prepareWorldData() {
    const { maps, resolution } = this.worldData;
    
    // Convert arrays back to typed arrays
    this.heightLOD = {
      lod0: new Float32Array(maps.heightLOD.lod0.data),
      lod1: new Float32Array(maps.heightLOD.lod1.data),
      lod2: new Float32Array(maps.heightLOD.lod2.data),
      lod3: new Float32Array(maps.heightLOD.lod3.data)
    };
    
    this.resolution = {
      lod0: maps.heightLOD.lod0.resolution,
      lod1: maps.heightLOD.lod1.resolution,
      lod2: maps.heightLOD.lod2.resolution,
      lod3: maps.heightLOD.lod3.resolution
    };
    
    console.log('World data prepared:', {
      resolution,
      lodSizes: this.resolution
    });
  }

  async createPipeline() {
    // Load shader
    const shaderCode = await fetch('/shaders/raymarcher.wgsl').then(r => r.text());
    const shaderModule = this.device.createShaderModule({ code: shaderCode });
    
    // Create render pipeline
    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [{
          format: navigator.gpu.getPreferredCanvasFormat()
        }]
      },
      primitive: {
        topology: 'triangle-list'
      }
    });
    
    // Create buffers for world data
    await this.createWorldBuffers();
  }

  async createWorldBuffers() {
    // Camera uniform buffer
    this.cameraBuffer = this.device.createBuffer({
      size: 64, // 4x vec4
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    
    // Height LOD buffers
    this.heightBuffers = {};
    for (const [lod, data] of Object.entries(this.heightLOD)) {
      this.heightBuffers[lod] = this.device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      });
      this.device.queue.writeBuffer(this.heightBuffers[lod], 0, data);
    }
    
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
    
    // Create bind group
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer } },
        { binding: 1, resource: { buffer: this.paramsBuffer } },
        { binding: 2, resource: { buffer: this.heightBuffers.lod0 } },
        { binding: 3, resource: { buffer: this.heightBuffers.lod1 } },
        { binding: 4, resource: { buffer: this.heightBuffers.lod2 } },
        { binding: 5, resource: { buffer: this.heightBuffers.lod3 } },
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
    // Pack camera data: position, forward, right, up
    const yaw = this.camera.rotation[0];
    const pitch = this.camera.rotation[1];
    
    const forward = [
      Math.sin(yaw) * Math.cos(pitch),
      -Math.sin(pitch),
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
    
    const cameraData = new Float32Array([
      ...this.camera.position, this.camera.fov,
      ...forward, 0,
      ...right, 0,
      ...up, 0
    ]);
    
    this.device.queue.writeBuffer(this.cameraBuffer, 0, cameraData);
  }

  render() {
    const encoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();
    
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.5, g: 0.7, b: 1.0, a: 1.0 }, // Sky color
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });
    
    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    
    // Draw fullscreen quad (2 triangles = 6 vertices)
    renderPass.draw(6, 1, 0, 0);
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
}
