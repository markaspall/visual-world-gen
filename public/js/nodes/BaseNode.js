/**
 * Base Node Class
 * All nodes inherit from this
 */
export class BaseNode {
  constructor(gpu) {
    this.gpu = gpu;
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
  createDataBuffer(size) {
    return this.gpu.createBuffer(
      size,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    );
  }

  /**
   * Helper: Upload data to GPU
   */
  uploadData(data) {
    return this.gpu.createBufferWithData(
      data,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    );
  }

  /**
   * Helper: Download data from GPU
   */
  async downloadData(buffer, size) {
    return await this.gpu.readBuffer(buffer, size);
  }

  /**
   * Helper: Execute compute shader
   */
  async executeShader(shaderCode, buffers, params, workgroupsX, workgroupsY = 1) {
    const pipeline = this.gpu.createComputePipeline(shaderCode);
    
    // Use the pipeline's auto-generated bind group layout
    const bindGroupLayout = pipeline.getBindGroupLayout(0);
    
    // Create bind group entries
    const bindGroupEntries = buffers.map((buffer, i) => ({
      binding: i,
      resource: { buffer: buffer }
    }));
    
    // Add uniform buffer if provided
    let uniformBuffer;
    if (params) {
      uniformBuffer = this.gpu.createUniformBuffer(params);
      bindGroupEntries.push({
        binding: buffers.length,
        resource: { buffer: uniformBuffer }
      });
    }
    
    const bindGroup = this.gpu.device.createBindGroup({
      layout: bindGroupLayout,
      entries: bindGroupEntries
    });
    
    // Execute
    await this.gpu.executeCompute(pipeline, bindGroup, workgroupsX, workgroupsY);
    
    // Cleanup uniform buffer
    if (uniformBuffer) {
      uniformBuffer.destroy();
    }
  }
}
