import { BaseNode } from './BaseNode.js';

/**
 * Temperature Node
 * Generates temperature map using Perlin noise
 * Can be influenced by latitude and elevation
 */
export class TemperatureNode extends BaseNode {
  static inputs = ['seed', 'height'];
  static outputs = ['output'];
  static defaultParams = {
    frequency: 2.0,
    octaves: 4,
    persistence: 0.5,
    lacunarity: 2.0,
    scale: 5.0,
    elevationInfluence: 0.3,
    latitudeInfluence: 0.2
  };

  async process(inputs, params) {
    const resolution = params.resolution || 512;
    const seed = inputs.seed || Date.now();
    const heightMap = inputs.height || new Float32Array(resolution * resolution).fill(0.5);

    const frequency = params.frequency || 2.0;
    const octaves = params.octaves || 4;
    const persistence = params.persistence || 0.5;
    const lacunarity = params.lacunarity || 2.0;
    const scale = params.scale || 5.0;
    const elevationInfluence = params.elevationInfluence || 0.3;
    const latitudeInfluence = params.latitudeInfluence || 0.2;

    console.log('Temperature node processing (GPU):', { resolution, frequency, octaves });

    const startTime = performance.now();
    
    // Load shader
    const shaderCode = await fetch('/shaders/temperature.wgsl').then(r => r.text());
    
    // Create shader module
    const shaderModule = this.gpu.device.createShaderModule({
      code: shaderCode
    });

    // Create buffers
    const paramsData = new ArrayBuffer(48); // 12 x 4 bytes
    const paramsView = new DataView(paramsData);
    paramsView.setUint32(0, resolution, true);
    paramsView.setUint32(4, seed, true);
    paramsView.setFloat32(8, frequency, true);
    paramsView.setUint32(12, octaves, true);
    paramsView.setFloat32(16, persistence, true);
    paramsView.setFloat32(20, lacunarity, true);
    paramsView.setFloat32(24, scale, true);
    paramsView.setFloat32(28, elevationInfluence, true);
    paramsView.setFloat32(32, latitudeInfluence, true);

    const paramsBuffer = this.gpu.device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(paramsBuffer, 0, paramsData);

    const heightBuffer = this.gpu.device.createBuffer({
      size: heightMap.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(heightBuffer, 0, heightMap);

    const outputBuffer = this.gpu.device.createBuffer({
      size: resolution * resolution * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const readBuffer = this.gpu.device.createBuffer({
      size: resolution * resolution * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // Create bind group layout and pipeline
    const bindGroupLayout = this.gpu.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
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
        { binding: 2, resource: { buffer: outputBuffer } },
      ]
    });

    // Execute compute shader
    const commandEncoder = this.gpu.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(Math.ceil(resolution / 8), Math.ceil(resolution / 8));
    passEncoder.end();
    
    commandEncoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, resolution * resolution * 4);
    this.gpu.device.queue.submit([commandEncoder.finish()]);

    // Read results
    await readBuffer.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(readBuffer.getMappedRange().slice(0));
    readBuffer.unmap();

    // Cleanup
    paramsBuffer.destroy();
    heightBuffer.destroy();
    outputBuffer.destroy();
    readBuffer.destroy();

    const endTime = performance.now();
    console.log(`Temperature generation complete (GPU) in ${(endTime - startTime).toFixed(2)}ms`);
    return { output: data };
  }

  perlin2D(x, y, frequency, octaves, persistence, lacunarity, seed) {
    let total = 0;
    let amplitude = 1;
    let maxValue = 0;
    let freq = frequency;

    for (let i = 0; i < octaves; i++) {
      total += this.noise(x * freq + seed, y * freq + seed) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      freq *= lacunarity;
    }

    return total / maxValue;
  }

  noise(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    
    x -= Math.floor(x);
    y -= Math.floor(y);
    
    const u = this.fade(x);
    const v = this.fade(y);
    
    const a = this.p[X] + Y;
    const b = this.p[X + 1] + Y;
    
    return this.lerp(v,
      this.lerp(u, this.grad(this.p[a], x, y), this.grad(this.p[b], x - 1, y)),
      this.lerp(u, this.grad(this.p[a + 1], x, y - 1), this.grad(this.p[b + 1], x - 1, y - 1))
    );
  }

  fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  lerp(t, a, b) {
    return a + t * (b - a);
  }

  grad(hash, x, y) {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
  }

  p = [151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,
    8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,
    35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,
    134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,
    55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,
    18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,
    250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,
    189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,
    172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,
    228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,
    107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,
    138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180,
    151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142];
}
