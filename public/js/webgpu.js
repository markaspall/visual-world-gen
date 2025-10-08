/**
 * WebGPU Context Manager
 * Handles GPU initialization, buffer management, and compute pipeline execution
 */
export class WebGPUContext {
  constructor() {
    this.adapter = null;
    this.device = null;
    this.queue = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    // Check for WebGPU support
    if (!navigator.gpu) {
      throw new Error('WebGPU is not supported in this browser');
    }

    // Request adapter
    this.adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance'
    });

    if (!this.adapter) {
      throw new Error('Failed to get WebGPU adapter');
    }

    console.log('GPU Adapter:', this.adapter);

    // Request device
    this.device = await this.adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: this.adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: this.adapter.limits.maxBufferSize,
        maxComputeWorkgroupStorageSize: this.adapter.limits.maxComputeWorkgroupStorageSize,
      }
    });

    this.queue = this.device.queue;
    this.initialized = true;

    console.log('WebGPU initialized successfully');
    console.log('Device limits:', this.device.limits);
  }

  /**
   * Create a storage buffer
   */
  createBuffer(size, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST) {
    return this.device.createBuffer({
      size: size,
      usage: usage,
      mappedAtCreation: false
    });
  }

  /**
   * Create and write to a buffer
   */
  createBufferWithData(data, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC) {
    const buffer = this.device.createBuffer({
      size: data.byteLength,
      usage: usage | GPUBufferUsage.COPY_DST,
      mappedAtCreation: false
    });

    this.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

  /**
   * Read data from a GPU buffer
   */
  async readBuffer(buffer, size) {
    const stagingBuffer = this.device.createBuffer({
      size: size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });

    const commandEncoder = this.device.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(buffer, 0, stagingBuffer, 0, size);
    this.device.queue.submit([commandEncoder.finish()]);

    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const arrayBuffer = stagingBuffer.getMappedRange();
    const data = new Float32Array(arrayBuffer.slice(0));
    
    stagingBuffer.unmap();
    stagingBuffer.destroy();

    return data;
  }
  /**
   * Create a compute pipeline from WGSL shader code
   */
  createComputePipeline(shaderCode, entryPoint = 'main') {
    const shaderModule = this.device.createShaderModule({
      code: shaderCode
    });

    return this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: entryPoint
      }
    });
  }

  /**
   * Execute a compute shader
   */
  async executeCompute(pipeline, bindGroup, workgroupsX, workgroupsY = 1, workgroupsZ = 1) {
    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(workgroupsX, workgroupsY, workgroupsZ);
    passEncoder.end();

    this.queue.submit([commandEncoder.finish()]);
    
    // Wait for completion
    await this.device.queue.onSubmittedWorkDone();
  }

  /**
   * Helper to create a bind group layout entry
   */
  static bufferBindGroupLayoutEntry(binding, visibility, type = 'storage') {
    return {
      binding: binding,
      visibility: visibility,
      buffer: {
        type: type
      }
    };
  }

  /**
   * Helper to create a bind group entry
   */
  static bufferBindGroupEntry(binding, buffer, offset = 0, size) {
    return {
      binding: binding,
      resource: {
        buffer: buffer,
        offset: offset,
        size: size
      }
    };
  }

  /**
   * Create a uniform buffer from parameters
   */
  createUniformBuffer(params) {
    const buffer = new ArrayBuffer(256); // Uniform buffers need 256-byte alignment
    const view = new DataView(buffer);
    
    let offset = 0;
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'number') {
        // Check if key suggests it should be a float (contains common float param names)
        const isFloatKey = key.toLowerCase().includes('min') || 
                          key.toLowerCase().includes('max') ||
                          key.toLowerCase().includes('val') ||
                          key.toLowerCase().includes('rate') ||
                          key.toLowerCase().includes('scale') ||
                          key.toLowerCase().includes('frequency') ||
                          key.toLowerCase().includes('persistence') ||
                          key.toLowerCase().includes('lacunarity') ||
                          key.toLowerCase().includes('weight');
        
        if (Number.isInteger(value) && !isFloatKey) {
          view.setUint32(offset, value, true);
          offset += 4;
        } else {
          view.setFloat32(offset, value, true);
          offset += 4;
        }
      }
    }

    return this.createBufferWithData(
      new Uint8Array(buffer), 
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    );
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.device) {
      this.device.destroy();
    }
    this.initialized = false;
  }
}

/**
 * GPU Buffer wrapper for easier management
 */
export class GPUDataBuffer {
  constructor(gpu, size, resolution) {
    this.gpu = gpu;
    this.size = size;
    this.resolution = resolution;
    this.buffer = gpu.createBuffer(size);
    this.data = null; // Cached CPU data
  }

  async read() {
    if (!this.data) {
      this.data = await this.gpu.readBuffer(this.buffer, this.size);
    }
    return this.data;
  }

  write(data) {
    this.gpu.queue.writeBuffer(this.buffer, 0, data);
    this.data = data;
  }

  invalidateCache() {
    this.data = null;
  }

  destroy() {
    this.buffer.destroy();
    this.data = null;
  }
}
