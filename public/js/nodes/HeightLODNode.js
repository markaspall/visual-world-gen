import { BaseNode } from './BaseNode.js';

export class HeightLODNode extends BaseNode {
  static inputs = ['height'];
  static outputs = ['lod0', 'lod1', 'lod2', 'lod3'];
  static defaultParams = {
    lod1Size: 128,
    lod2Size: 32,
    lod3Size: 8
  };

  async process(inputs, params) {
    const resolution = params.resolution || 512;
    const heightMap = inputs.height;

    if (!heightMap) {
      throw new Error('HeightLOD requires height input');
    }

    console.log('Height LOD generation (GPU):', { 
      inputRes: resolution,
      lod1: params.lod1Size,
      lod2: params.lod2Size,
      lod3: params.lod3Size
    });
    
    const startTime = performance.now();

    // Load shader
    const shaderCode = await fetch('/shaders/heightLOD.wgsl').then(r => r.text());
    const shaderModule = this.gpu.device.createShaderModule({ code: shaderCode });

    // LOD 0 is the original
    const lod0 = heightMap;

    // Generate LOD 1 (512 → 128)
    const lod1 = await this.generateLOD(
      shaderModule,
      heightMap,
      resolution,
      params.lod1Size,
      Math.floor(resolution / params.lod1Size)
    );

    // Generate LOD 2 (128 → 32)
    const lod2 = await this.generateLOD(
      shaderModule,
      lod1,
      params.lod1Size,
      params.lod2Size,
      Math.floor(params.lod1Size / params.lod2Size)
    );

    // Generate LOD 3 (32 → 8)
    const lod3 = await this.generateLOD(
      shaderModule,
      lod2,
      params.lod2Size,
      params.lod3Size,
      Math.floor(params.lod2Size / params.lod3Size)
    );

    const endTime = performance.now();
    console.log(`Height LOD generation complete in ${(endTime - startTime).toFixed(2)}ms`);
    console.log('  LOD sizes:', {
      lod0: `${resolution}×${resolution}`,
      lod1: `${params.lod1Size}×${params.lod1Size}`,
      lod2: `${params.lod2Size}×${params.lod2Size}`,
      lod3: `${params.lod3Size}×${params.lod3Size}`
    });

    return {
      lod0: lod0,
      lod1: lod1,
      lod2: lod2,
      lod3: lod3
    };
  }

  async generateLOD(shaderModule, inputMap, inputRes, outputRes, poolSize) {
    // Create params buffer
    const paramsData = new Uint32Array([
      inputRes,
      outputRes,
      poolSize,
      0 // padding
    ]);
    
    const paramsBuffer = this.gpu.device.createBuffer({
      size: paramsData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(paramsBuffer, 0, paramsData);

    // Create input buffer
    const inputBuffer = this.gpu.device.createBuffer({
      size: inputMap.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(inputBuffer, 0, inputMap);

    // Create output buffer
    const outputBuffer = this.gpu.device.createBuffer({
      size: outputRes * outputRes * 4, // Float32
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    // Create pipeline
    const bindGroupLayout = this.gpu.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    const pipeline = this.gpu.device.createComputePipeline({
      layout: this.gpu.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    const bindGroup = this.gpu.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: inputBuffer } },
        { binding: 2, resource: { buffer: outputBuffer } },
      ],
    });

    // Execute
    const commandEncoder = this.gpu.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(
      Math.ceil(outputRes / 8),
      Math.ceil(outputRes / 8)
    );
    passEncoder.end();

    // Read back
    const readBuffer = this.gpu.device.createBuffer({
      size: outputRes * outputRes * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    
    commandEncoder.copyBufferToBuffer(
      outputBuffer,
      0,
      readBuffer,
      0,
      outputRes * outputRes * 4
    );
    
    this.gpu.device.queue.submit([commandEncoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(readBuffer.getMappedRange().slice(0));
    readBuffer.unmap();

    // Cleanup
    paramsBuffer.destroy();
    inputBuffer.destroy();
    outputBuffer.destroy();
    readBuffer.destroy();

    return result;
  }
}
