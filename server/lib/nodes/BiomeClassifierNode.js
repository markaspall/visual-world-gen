import { BaseNode } from './BaseNode.js';

/**
 * Biome Classifier Node - Server-side
 * Classifies terrain into biomes based on height, moisture, temperature, and water
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
    const paramsBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(paramsBuffer, 0, paramsData);

    const biomeRulesBuffer = this.device.createBuffer({
      size: biomeRulesData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(biomeRulesBuffer, 0, biomeRulesData);

    const heightBuffer = this.device.createBuffer({
      size: heightMap.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(heightBuffer, 0, heightMap);

    const moistureBuffer = this.device.createBuffer({
      size: moistureMap.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(moistureBuffer, 0, moistureMap);

    const temperatureBuffer = this.device.createBuffer({
      size: temperatureMap.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(temperatureBuffer, 0, temperatureMap);

    const waterBuffer = this.device.createBuffer({
      size: waterMap.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(waterBuffer, 0, waterMap);

    const colorOutputBuffer = this.device.createBuffer({
      size: resolution * resolution * 4 * 4, // vec4<f32>
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const biomeOutputBuffer = this.device.createBuffer({
      size: resolution * resolution * 4, // u32
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    // Biome classifier shader (inline)
    const shaderCode = `
      struct Params {
        resolution: u32,
        numBiomes: u32,
        padding: u32,
        padding2: u32,
      }

      struct BiomeRule {
        heightMin: f32,
        heightMax: f32,
        moistureMin: f32,
        moistureMax: f32,
        tempMin: f32,
        tempMax: f32,
        waterMin: f32,
        waterMax: f32,
        colorR: f32,
        colorG: f32,
        colorB: f32,
        padding: f32,
      }

      @group(0) @binding(0) var<uniform> params: Params;
      @group(0) @binding(1) var<storage, read> biomes: array<BiomeRule>;
      @group(0) @binding(2) var<storage, read> heightMap: array<f32>;
      @group(0) @binding(3) var<storage, read> moistureMap: array<f32>;
      @group(0) @binding(4) var<storage, read> temperatureMap: array<f32>;
      @group(0) @binding(5) var<storage, read> waterMap: array<f32>;
      @group(0) @binding(6) var<storage, read_write> colorOutput: array<vec4<f32>>;
      @group(0) @binding(7) var<storage, read_write> biomeOutput: array<u32>;

      fn matchesBiome(height: f32, moisture: f32, temp: f32, water: f32, biome: BiomeRule) -> i32 {
        var specificity = 0;
        
        if (biome.heightMin >= 0.0) {
          if (height < biome.heightMin || height > biome.heightMax) {
            return -1;
          }
          specificity++;
        }
        
        if (biome.moistureMin >= 0.0) {
          if (moisture < biome.moistureMin || moisture > biome.moistureMax) {
            return -1;
          }
          specificity++;
        }
        
        if (biome.tempMin >= 0.0) {
          if (temp < biome.tempMin || temp > biome.tempMax) {
            return -1;
          }
          specificity++;
        }
        
        if (biome.waterMin >= 0.0) {
          if (water < biome.waterMin || water > biome.waterMax) {
            return -1;
          }
          specificity++;
        }
        
        return specificity;
      }

      @compute @workgroup_size(8, 8)
      fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let x = global_id.x;
        let y = global_id.y;
        
        if (x >= params.resolution || y >= params.resolution) {
          return;
        }
        
        let idx = y * params.resolution + x;
        
        let height = heightMap[idx];
        let moisture = moistureMap[idx];
        let temp = temperatureMap[idx];
        let water = waterMap[idx];
        
        var bestBiome = 0u;
        var bestSpecificity = -1;
        
        for (var i = 0u; i < params.numBiomes; i++) {
          let spec = matchesBiome(height, moisture, temp, water, biomes[i]);
          if (spec > bestSpecificity) {
            bestBiome = i;
            bestSpecificity = spec;
          }
        }
        
        let biome = biomes[bestBiome];
        colorOutput[idx] = vec4<f32>(biome.colorR, biome.colorG, biome.colorB, 1.0);
        biomeOutput[idx] = bestBiome;
      }
    `;

    // Create shader module and pipeline
    const shaderModule = this.device.createShaderModule({ code: shaderCode });

    const pipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: biomeRulesBuffer } },
        { binding: 2, resource: { buffer: heightBuffer } },
        { binding: 3, resource: { buffer: moistureBuffer } },
        { binding: 4, resource: { buffer: temperatureBuffer } },
        { binding: 5, resource: { buffer: waterBuffer } },
        { binding: 6, resource: { buffer: colorOutputBuffer } },
        { binding: 7, resource: { buffer: biomeOutputBuffer } },
      ],
    });

    // Execute
    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(Math.ceil(resolution / 8), Math.ceil(resolution / 8));
    passEncoder.end();
    this.device.queue.submit([commandEncoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();

    // Read results
    const biomeOutput = await this.downloadData(biomeOutputBuffer, resolution * resolution * 4);

    // Cleanup
    paramsBuffer.destroy();
    biomeRulesBuffer.destroy();
    heightBuffer.destroy();
    moistureBuffer.destroy();
    temperatureBuffer.destroy();
    waterBuffer.destroy();
    colorOutputBuffer.destroy();
    biomeOutputBuffer.destroy();

    // Return biome IDs (convert from Uint32 to Uint8)
    const output = new Uint8Array(resolution * resolution);
    for (let i = 0; i < output.length; i++) {
      output[i] = biomeOutput[i];
    }

    return {
      output,
      biomeList: biomes.map((b, i) => ({ id: i, name: b.name, color: b.color }))
    };
  }

  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 128, g: 128, b: 128 };
  }
}
