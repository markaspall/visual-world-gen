import { BaseNode } from './BaseNode.js';

/**
 * Biome Classifier Node
 * Classifies terrain into biomes based on height, moisture, temperature, and water
 * Uses rule-based matching with "most specific wins" logic
 */
export class BiomeClassifierNode extends BaseNode {
  static inputs = ['height', 'moisture', 'temperature', 'water'];
  static outputs = ['output', 'colorMap', 'biomeList'];
  static defaultParams = {
    biomes: [
      { name: 'Deep Ocean', color: '#0A2463', height: [0, 0.3], moisture: null, temperature: null, water: [0.01, 1.0] },
      { name: 'Ocean', color: '#1E40AF', height: [0.3, 0.4], moisture: null, temperature: null, water: [0.01, 1.0] },
      { name: 'Beach', color: '#FDE68A', height: [0.4, 0.45], moisture: null, temperature: [0.3, 1.0], water: [0, 0] },
      { name: 'Desert', color: '#F59E0B', height: [0.45, 1.0], moisture: [0, 0.25], temperature: [0.6, 1.0], water: [0, 0] },
      { name: 'Savanna', color: '#D97706', height: [0.45, 0.7], moisture: [0.25, 0.45], temperature: [0.5, 0.9], water: [0, 0] },
      { name: 'Grassland', color: '#84CC16', height: [0.45, 0.7], moisture: [0.3, 0.6], temperature: [0.4, 0.7], water: [0, 0] },
      { name: 'Tropical Forest', color: '#15803D', height: [0.45, 0.7], moisture: [0.6, 1.0], temperature: [0.7, 1.0], water: [0, 0] },
      { name: 'Temperate Forest', color: '#059669', height: [0.45, 0.7], moisture: [0.5, 0.8], temperature: [0.3, 0.6], water: [0, 0] },
      { name: 'Taiga', color: '#064E3B', height: [0.45, 0.8], moisture: [0.4, 0.7], temperature: [0.1, 0.4], water: [0, 0] },
      { name: 'Tundra', color: '#9CA3AF', height: [0.45, 0.8], moisture: null, temperature: [0, 0.2], water: [0, 0] },
      { name: 'Rocky Mountain', color: '#78716C', height: [0.7, 0.85], moisture: null, temperature: [0.2, 0.6], water: [0, 0] },
      { name: 'Snow Peak', color: '#F3F4F6', height: [0.8, 1.0], moisture: null, temperature: null, water: [0, 0] },
      { name: 'Alpine', color: '#E5E7EB', height: [0.7, 1.0], moisture: null, temperature: [0, 0.3], water: [0, 0] }
    ]
  };

  async process(inputs, params) {
    const resolution = params.resolution || 512;
    const heightMap = inputs.height;
    const moistureMap = inputs.moisture || new Float32Array(resolution * resolution).fill(0.5);
    const temperatureMap = inputs.temperature || new Float32Array(resolution * resolution).fill(0.5);
    const waterMap = inputs.water || new Float32Array(resolution * resolution).fill(0);

    if (!heightMap) {
      throw new Error('BiomeClassifier requires height input');
    }

    const biomes = params.biomes || BiomeClassifierNode.defaultParams.biomes;

    console.log('Biome classification (GPU):', { resolution, numBiomes: biomes.length });

    const startTime = performance.now();

    // Load shader
    const shaderCode = await fetch('/shaders/biomeClassifier.wgsl').then(r => r.text());
    
    const shaderModule = this.gpu.device.createShaderModule({
      code: shaderCode
    });

    // Prepare biome rules for GPU (struct array)
    const biomeRulesData = new Float32Array(biomes.length * 12); // 12 floats per biome
    for (let i = 0; i < biomes.length; i++) {
      const b = biomes[i];
      const rgb = this.hexToRgb(b.color);
      const offset = i * 12;
      
      biomeRulesData[offset] = b.height ? b.height[0] : -1;
      biomeRulesData[offset + 1] = b.height ? b.height[1] : -1;
      biomeRulesData[offset + 2] = b.moisture ? b.moisture[0] : -1;
      biomeRulesData[offset + 3] = b.moisture ? b.moisture[1] : -1;
      biomeRulesData[offset + 4] = b.temperature ? b.temperature[0] : -1;
      biomeRulesData[offset + 5] = b.temperature ? b.temperature[1] : -1;
      biomeRulesData[offset + 6] = b.water ? b.water[0] : -1;
      biomeRulesData[offset + 7] = b.water ? b.water[1] : -1;
      biomeRulesData[offset + 8] = rgb.r / 255;
      biomeRulesData[offset + 9] = rgb.g / 255;
      biomeRulesData[offset + 10] = rgb.b / 255;
      biomeRulesData[offset + 11] = 0; // padding
    }

    // Create buffers
    const paramsData = new Uint32Array([resolution, biomes.length, 0, 0]);
    const paramsBuffer = this.gpu.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(paramsBuffer, 0, paramsData);

    const biomeRulesBuffer = this.gpu.device.createBuffer({
      size: biomeRulesData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(biomeRulesBuffer, 0, biomeRulesData);

    const heightBuffer = this.gpu.device.createBuffer({
      size: heightMap.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(heightBuffer, 0, heightMap);

    const moistureBuffer = this.gpu.device.createBuffer({
      size: moistureMap.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(moistureBuffer, 0, moistureMap);

    const temperatureBuffer = this.gpu.device.createBuffer({
      size: temperatureMap.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(temperatureBuffer, 0, temperatureMap);

    const waterBuffer = this.gpu.device.createBuffer({
      size: waterMap.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(waterBuffer, 0, waterMap);

    const colorOutputBuffer = this.gpu.device.createBuffer({
      size: resolution * resolution * 16, // vec4<f32>
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const biomeOutputBuffer = this.gpu.device.createBuffer({
      size: resolution * resolution * 4, // u32
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const colorReadBuffer = this.gpu.device.createBuffer({
      size: resolution * resolution * 16,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const biomeReadBuffer = this.gpu.device.createBuffer({
      size: resolution * resolution * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // Create pipeline
    const bindGroupLayout = this.gpu.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
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
        { binding: 1, resource: { buffer: biomeRulesBuffer } },
        { binding: 2, resource: { buffer: heightBuffer } },
        { binding: 3, resource: { buffer: moistureBuffer } },
        { binding: 4, resource: { buffer: temperatureBuffer } },
        { binding: 5, resource: { buffer: waterBuffer } },
        { binding: 6, resource: { buffer: colorOutputBuffer } },
        { binding: 7, resource: { buffer: biomeOutputBuffer } },
      ]
    });

    // Execute
    const commandEncoder = this.gpu.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(Math.ceil(resolution / 8), Math.ceil(resolution / 8));
    passEncoder.end();
    
    commandEncoder.copyBufferToBuffer(colorOutputBuffer, 0, colorReadBuffer, 0, resolution * resolution * 16);
    commandEncoder.copyBufferToBuffer(biomeOutputBuffer, 0, biomeReadBuffer, 0, resolution * resolution * 4);
    this.gpu.device.queue.submit([commandEncoder.finish()]);

    // Read color results
    await colorReadBuffer.mapAsync(GPUMapMode.READ);
    const colorFloats = new Float32Array(colorReadBuffer.getMappedRange().slice(0));
    colorReadBuffer.unmap();
    
    // Read biome IDs
    await biomeReadBuffer.mapAsync(GPUMapMode.READ);
    const biomeIdsU32 = new Uint32Array(biomeReadBuffer.getMappedRange().slice(0));
    biomeReadBuffer.unmap();
    
    // Convert to Uint8Array for smaller size
    const biomeIds = new Uint8Array(resolution * resolution);
    for (let i = 0; i < resolution * resolution; i++) {
      biomeIds[i] = biomeIdsU32[i] & 0xFF;
    }

    // Convert to Uint8ClampedArray
    const colorData = new Uint8ClampedArray(resolution * resolution * 4);
    for (let i = 0; i < resolution * resolution; i++) {
      colorData[i * 4] = Math.floor(colorFloats[i * 4] * 255);
      colorData[i * 4 + 1] = Math.floor(colorFloats[i * 4 + 1] * 255);
      colorData[i * 4 + 2] = Math.floor(colorFloats[i * 4 + 2] * 255);
      colorData[i * 4 + 3] = 255;
    }

    // Cleanup
    paramsBuffer.destroy();
    biomeRulesBuffer.destroy();
    heightBuffer.destroy();
    moistureBuffer.destroy();
    temperatureBuffer.destroy();
    waterBuffer.destroy();
    colorOutputBuffer.destroy();
    biomeOutputBuffer.destroy();
    colorReadBuffer.destroy();
    biomeReadBuffer.destroy();

    const endTime = performance.now();
    console.log(`Biome classification complete (GPU) in ${(endTime - startTime).toFixed(2)}ms`);

    // Create biome list with IDs for BlockClassifier
    const biomeList = biomes.map((biome, index) => ({
      id: index,
      name: biome.name,
      color: biome.color
    }));

    return { 
      output: biomeIds,
      colorMap: colorData,
      biomeList: biomeList
    };
  }

  /**
   * Classify a single pixel into a biome
   * Uses "most specific wins" logic - biome with most matching thresholds wins
   */
  classifyBiome(height, moisture, temperature, water, biomes) {
    let bestBiome = 0;
    let bestSpecificity = -1;

    for (let i = 0; i < biomes.length; i++) {
      const biome = biomes[i];
      let matches = true;
      let specificity = 0;

      // Check height threshold
      if (biome.height) {
        if (height < biome.height[0] || height > biome.height[1]) {
          matches = false;
        } else {
          specificity++;
        }
      }

      // Check moisture threshold
      if (biome.moisture) {
        if (moisture < biome.moisture[0] || moisture > biome.moisture[1]) {
          matches = false;
        } else {
          specificity++;
        }
      }

      // Check temperature threshold
      if (biome.temperature) {
        if (temperature < biome.temperature[0] || temperature > biome.temperature[1]) {
          matches = false;
        } else {
          specificity++;
        }
      }

      // Check water threshold
      if (biome.water) {
        if (water < biome.water[0] || water > biome.water[1]) {
          matches = false;
        } else {
          specificity++;
        }
      }

      // If matches and more specific than current best, use it
      if (matches && specificity > bestSpecificity) {
        bestBiome = i;
        bestSpecificity = specificity;
      }
    }

    return bestBiome;
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
