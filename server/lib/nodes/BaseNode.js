/**
 * Base Node Class - Server-side
 * All server nodes inherit from this
 */
export class BaseNode {
  constructor(device) {
    this.device = device;
  }

  /**
   * Process method - to be overridden by subclasses
   * @param {Object} inputs - Map of input name to data
   * @param {Object} params - Node parameters
   * @returns {Object} - Map of output name to data
   */
  async process(inputs, params) {
    throw new Error('process() must be implemented by subclass');
  }

  /**
   * Helper: Create data buffer on GPU
   */
  createDataBuffer(size, usage = null) {
    return this.device.createBuffer({
      size: size,
      usage: usage || (GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST)
    });
  }

  /**
   * Helper: Create uniform buffer
   */
  createUniformBuffer(params) {
    // Convert params object to binary data
    const data = this.paramsToBuffer(params);
    const buffer = this.device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

  /**
   * Helper: Convert params to buffer
   */
  paramsToBuffer(params) {
    // Calculate size (4 bytes per value, rounded up to 16-byte alignment)
    const values = Object.values(params);
    const size = Math.ceil(values.length * 4 / 16) * 16;
    const buffer = new ArrayBuffer(size);
    const view = new DataView(buffer);
    
    let offset = 0;
    for (const value of values) {
      if (typeof value === 'number') {
        if (Number.isInteger(value)) {
          view.setUint32(offset, value, true);
        } else {
          view.setFloat32(offset, value, true);
        }
        offset += 4;
      }
    }
    
    return new Uint8Array(buffer);
  }

  /**
   * Helper: Download data from GPU
   */
  async downloadData(buffer, size) {
    // Create staging buffer
    const stagingBuffer = this.device.createBuffer({
      size: size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    
    // Copy to staging
    const commandEncoder = this.device.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(buffer, 0, stagingBuffer, 0, size);
    this.device.queue.submit([commandEncoder.finish()]);
    
    // Wait and read
    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(stagingBuffer.getMappedRange().slice(0));
    stagingBuffer.unmap();
    stagingBuffer.destroy();
    
    return data;
  }

  /**
   * Helper: Execute compute shader
   */
  async executeShader(shaderCode, buffers, params, workgroupsX, workgroupsY = 1) {
    // Create shader module
    const shaderModule = this.device.createShaderModule({
      code: shaderCode
    });
    
    // Create pipeline
    const pipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main'
      }
    });
    
    // Create bind group entries
    const bindGroupEntries = buffers.map((buffer, i) => ({
      binding: i,
      resource: { buffer: buffer }
    }));
    
    // Add uniform buffer if provided
    let uniformBuffer;
    if (params) {
      uniformBuffer = this.createUniformBuffer(params);
      bindGroupEntries.push({
        binding: buffers.length,
        resource: { buffer: uniformBuffer }
      });
    }
    
    // Create bind group
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: bindGroupEntries
    });
    
    // Execute
    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(workgroupsX, workgroupsY);
    passEncoder.end();
    this.device.queue.submit([commandEncoder.finish()]);
    
    // Wait for completion
    await this.device.queue.onSubmittedWorkDone();
    
    // Cleanup
    if (uniformBuffer) {
      uniformBuffer.destroy();
    }
  }
}
