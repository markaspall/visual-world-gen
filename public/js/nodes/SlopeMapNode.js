import { BaseNode } from './BaseNode.js';

export class SlopeMapNode extends BaseNode {
  static inputs = ['height'];
  static outputs = ['magnitude', 'direction'];
  static defaultParams = {};

  async process(inputs, params) {
    const heightMap = inputs.height;
    if (!heightMap) {
      throw new Error('SlopeMapNode requires height input');
    }

    const resolution = params.resolution || 512;

    console.log('Slope calculation (GPU):', { resolution });

    const startTime = performance.now();

    // Load shader
    const shaderCode = await fetch('/shaders/gradient.wgsl').then(r => r.text());
    
    const shaderModule = this.gpu.device.createShaderModule({
      code: shaderCode
    });

    // Create buffers
    const paramsData = new Uint32Array([resolution, 0, 0, 0]);
    const paramsBuffer = this.gpu.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(paramsBuffer, 0, paramsData);

    const heightBuffer = this.gpu.device.createBuffer({
      size: heightMap.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(heightBuffer, 0, heightMap);

    const magnitudeBuffer = this.gpu.device.createBuffer({
      size: resolution * resolution * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const directionBuffer = this.gpu.device.createBuffer({
      size: resolution * resolution * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const readMagnitudeBuffer = this.gpu.device.createBuffer({
      size: resolution * resolution * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const readDirectionBuffer = this.gpu.device.createBuffer({
      size: resolution * resolution * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // Create pipeline
    const bindGroupLayout = this.gpu.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ]
    });

    const pipeline = this.gpu.device.createComputePipeline({
      layout: this.gpu.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module: shaderModule, entryPoint: 'main' }
    });

    const bindGroup = this.gpu.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: heightBuffer } },
        { binding: 2, resource: { buffer: magnitudeBuffer } },
        { binding: 3, resource: { buffer: directionBuffer } },
      ]
    });

    // Execute
    const commandEncoder = this.gpu.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(Math.ceil(resolution / 8), Math.ceil(resolution / 8));
    passEncoder.end();
    
    commandEncoder.copyBufferToBuffer(magnitudeBuffer, 0, readMagnitudeBuffer, 0, resolution * resolution * 4);
    commandEncoder.copyBufferToBuffer(directionBuffer, 0, readDirectionBuffer, 0, resolution * resolution * 4);
    this.gpu.device.queue.submit([commandEncoder.finish()]);

    // Read results
    await readMagnitudeBuffer.mapAsync(GPUMapMode.READ);
    const magnitudeData = new Float32Array(readMagnitudeBuffer.getMappedRange().slice(0));
    readMagnitudeBuffer.unmap();

    await readDirectionBuffer.mapAsync(GPUMapMode.READ);
    const directionData = new Float32Array(readDirectionBuffer.getMappedRange().slice(0));
    readDirectionBuffer.unmap();

    // Cleanup
    paramsBuffer.destroy();
    heightBuffer.destroy();
    magnitudeBuffer.destroy();
    directionBuffer.destroy();
    readMagnitudeBuffer.destroy();
    readDirectionBuffer.destroy();

    const endTime = performance.now();
    console.log(`Slope calculation complete (GPU) in ${(endTime - startTime).toFixed(2)}ms`);

    return {
      magnitude: magnitudeData,
      direction: directionData
    };
  }
}
