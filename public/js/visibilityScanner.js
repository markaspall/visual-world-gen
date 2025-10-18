/**
 * Visibility Scanner
 * Performs low-res ray scan to detect which chunks are needed
 */

export class VisibilityScanner {
  constructor(device, camera, chunkSize = 32) {
    this.device = device;
    this.camera = camera;
    this.chunkSize = chunkSize;
    
    // Scan resolution (calculated based on view distance)
    this.viewDistanceChunks = 16;  // Can see 16 chunks away (512 voxels) - increased!
    this.scanWidth = Math.ceil(this.viewDistanceChunks * 4.5);  // ~4.5 rays per chunk (denser!)
    this.scanHeight = Math.ceil(this.scanWidth * 0.66);  // Account for vertical FOV
    
    console.log(`📡 Visibility scanner initialized: ${this.scanWidth}×${this.scanHeight} = ${this.scanWidth * this.scanHeight} rays, view distance: ${this.viewDistanceChunks} chunks (${this.viewDistanceChunks * chunkSize}m)`);
    
    // Request buffer: 3D grid of chunks
    // Size: (viewDist*2+1)³ to cover all chunks in sphere
    this.gridSize = this.viewDistanceChunks * 2 + 1;
    this.requestBufferSize = this.gridSize * this.gridSize * this.gridSize;
    
    this.init();
  }
  
  async init() {
    // Load shader
    const shaderCode = await fetch('/shaders/visibility_scan.wgsl').then(r => r.text());
    
    // Create shader module
    this.shaderModule = this.device.createShaderModule({
      label: 'Visibility Scan Shader',
      code: shaderCode
    });
    
    // Create request buffer (atomic counters for each chunk)
    this.requestBuffer = this.device.createBuffer({
      label: 'Chunk Request Buffer',
      size: this.requestBufferSize * 4,  // u32 per chunk
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    });
    
    // Staging buffer for readback
    this.stagingBuffer = this.device.createBuffer({
      label: 'Chunk Request Staging',
      size: this.requestBufferSize * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });
    
    // Create uniform buffer for render params
    this.renderParamsBuffer = this.device.createBuffer({
      label: 'Visibility Scan Params',
      size: 32,  // resolution(8) + time(4) + maxDist(4) + chunkSize(4) + viewDist(4) + padding
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    
    // Create bind group layout
    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: 'Visibility Scan Bind Group Layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },  // camera
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },  // params
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },  // chunk metadata (dummy for now)
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }   // requests
      ]
    });
    
    // Create pipeline
    this.pipeline = this.device.createComputePipeline({
      label: 'Visibility Scan Pipeline',
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout]
      }),
      compute: {
        module: this.shaderModule,
        entryPoint: 'main'
      }
    });
    
    // Dummy chunk metadata buffer (empty for now)
    this.dummyChunkMetadata = this.device.createBuffer({
      label: 'Dummy Chunk Metadata',
      size: 16,  // Minimum size
      usage: GPUBufferUsage.STORAGE
    });
  }
  
  /**
   * Perform visibility scan
   * Returns array of chunk coordinates that need to be loaded
   */
  async scan(cameraBuffer, maxDistance = 160) {
    // Clear request buffer
    this.device.queue.writeBuffer(
      this.requestBuffer,
      0,
      new Uint32Array(this.requestBufferSize)
    );
    
    // Update render params
    const paramsData = new Float32Array([
      this.scanWidth, this.scanHeight,  // resolution
      performance.now() / 1000,  // time
      maxDistance,  // max distance
      this.chunkSize,  // chunk size
      this.viewDistanceChunks,  // view distance in chunks
      0, 0  // padding
    ]);
    this.device.queue.writeBuffer(this.renderParamsBuffer, 0, paramsData);
    
    // Create bind group
    const bindGroup = this.device.createBindGroup({
      label: 'Visibility Scan Bind Group',
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: cameraBuffer } },
        { binding: 1, resource: { buffer: this.renderParamsBuffer } },
        { binding: 2, resource: { buffer: this.dummyChunkMetadata } },
        { binding: 3, resource: { buffer: this.requestBuffer } }
      ]
    });
    
    // Execute scan
    const commandEncoder = this.device.createCommandEncoder({
      label: 'Visibility Scan Encoder'
    });
    
    const passEncoder = commandEncoder.beginComputePass({
      label: 'Visibility Scan Pass'
    });
    
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    
    // Dispatch: scanWidth×scanHeight rays
    const workgroupsX = Math.ceil(this.scanWidth / 8);
    const workgroupsY = Math.ceil(this.scanHeight / 8);
    passEncoder.dispatchWorkgroups(workgroupsX, workgroupsY, 1);
    
    passEncoder.end();
    
    // Copy to staging for readback
    commandEncoder.copyBufferToBuffer(
      this.requestBuffer, 0,
      this.stagingBuffer, 0,
      this.requestBufferSize * 4
    );
    
    this.device.queue.submit([commandEncoder.finish()]);
    
    // Read results
    await this.stagingBuffer.mapAsync(GPUMapMode.READ);
    const requestData = new Uint32Array(this.stagingBuffer.getMappedRange());
    
    // Extract requested chunks
    const requestedChunks = [];
    const cameraChunk = this.worldToChunk(this.camera.position);
    
    for (let i = 0; i < this.requestBufferSize; i++) {
      if (requestData[i] > 0) {
        // Convert index back to chunk coordinates
        const gridSize = this.gridSize;
        const z = Math.floor(i / (gridSize * gridSize));
        const y = Math.floor((i % (gridSize * gridSize)) / gridSize);
        const x = i % gridSize;
        
        // Convert relative to absolute
        const cx = x - this.viewDistanceChunks + cameraChunk.cx;
        const cy = y - this.viewDistanceChunks + cameraChunk.cy;
        const cz = z - this.viewDistanceChunks + cameraChunk.cz;
        
        // CRITICAL FIX: Only load chunks within ±2 Y levels of camera
        // This prevents the 600-chunk budget from being diluted across 33 vertical levels!
        const yDelta = Math.abs(cy - cameraChunk.cy);
        if (yDelta > 2) {
          continue;  // Skip chunks more than 2 Y levels away
        }
        
        requestedChunks.push({
          cx, cy, cz,
          rayCount: requestData[i]  // How many rays hit this chunk
        });
      }
    }
    
    this.stagingBuffer.unmap();
    
    // Sort by ray count (more rays = more visible/important)
    requestedChunks.sort((a, b) => b.rayCount - a.rayCount);
    
    return requestedChunks;
  }
  
  worldToChunk(position) {
    return {
      cx: Math.floor(position[0] / this.chunkSize),
      cy: Math.floor(position[1] / this.chunkSize),
      cz: Math.floor(position[2] / this.chunkSize)
    };
  }
  
  /**
   * Calculate optimal scan resolution for given view distance
   */
  static calculateScanResolution(viewDistanceChunks, aspectRatio = 16/9) {
    const width = Math.ceil(viewDistanceChunks * 3.2);
    const height = Math.ceil(width / aspectRatio * 0.66);
    return { width, height, totalRays: width * height };
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      scanResolution: `${this.scanWidth}×${this.scanHeight}`,
      totalRays: this.scanWidth * this.scanHeight,
      gridSize: `${this.gridSize}³`,
      maxChunks: this.requestBufferSize
    };
  }
}
