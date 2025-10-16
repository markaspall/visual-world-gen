import { BaseNode } from './BaseNode.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Block Classifier Node - Server-side (GPU)
 * FEATURE PARITY with client version - uses same GPU shader
 */
export class BlockClassifierNode extends BaseNode {
  static inputs = ['biomes', 'water', 'height', 'noise1', 'biomeList', 'animations'];
  static outputs = ['terrainBlocks', 'waterBlocks', 'blockMapVis'];
  static defaultParams = {
    blocks: [
      { id: 0, name: 'Air', color: '#000000', transparent: 1.0, emissive: 0.0, reflective: 0.0, refractive: 1.0, animationId: null },
      { id: 1, name: 'Grass', color: '#45b545', transparent: 0.0, emissive: 0.0, reflective: 0.0, refractive: 1.0, animationId: null },
      { id: 2, name: 'Dirt', color: '#8b5a3c', transparent: 0.0, emissive: 0.0, reflective: 0.0, refractive: 1.0, animationId: null },
      { id: 3, name: 'Stone', color: '#808080', transparent: 0.0, emissive: 0.0, reflective: 0.0, refractive: 1.0, animationId: null },
      { id: 4, name: 'Sand', color: '#edc9af', transparent: 0.0, emissive: 0.0, reflective: 0.0, refractive: 1.0, animationId: null },
      { id: 5, name: 'Snow', color: '#ffffff', transparent: 0.0, emissive: 0.0, reflective: 0.3, refractive: 1.0, animationId: null },
      { id: 6, name: 'Water', color: '#1e90ff', transparent: 0.8, emissive: 0.0, reflective: 0.2, refractive: 1.33, animationId: null },
      { id: 7, name: 'Tree Seed', color: '#228b22', transparent: 0.0, emissive: 0.0, reflective: 0.0, refractive: 1.0, animationId: null },
    ],
    biomeRules: [
      { biomeId: 0, biomeName: 'Deep Ocean', blocks: [{ blockId: 4, blockName: 'Sand', weight: 1.0 }], waterBlocks: [{ blockId: 6, blockName: 'Ocean Water', weight: 1.0 }] },
      { biomeId: 1, biomeName: 'Ocean', blocks: [{ blockId: 4, blockName: 'Sand', weight: 1.0 }], waterBlocks: [{ blockId: 6, blockName: 'Ocean Water', weight: 1.0 }] },
      { biomeId: 2, biomeName: 'Beach', blocks: [{ blockId: 4, blockName: 'Sand', weight: 1.0 }], waterBlocks: [{ blockId: 6, blockName: 'Clear Water', weight: 1.0 }] },
      { biomeId: 3, biomeName: 'Desert', blocks: [{ blockId: 4, blockName: 'Sand', weight: 1.0 }], waterBlocks: [{ blockId: 6, blockName: 'Clear Water', weight: 1.0 }] },
      { biomeId: 4, biomeName: 'Savanna', blocks: [{ blockId: 1, blockName: 'Grass', weight: 0.9 }, { blockId: 7, blockName: 'Tree Seed', weight: 0.1 }], waterBlocks: [{ blockId: 6, blockName: 'Clear Water', weight: 1.0 }] },
      { biomeId: 5, biomeName: 'Grassland', blocks: [{ blockId: 1, blockName: 'Grass', weight: 1.0 }], waterBlocks: [{ blockId: 6, blockName: 'Clear Water', weight: 1.0 }] },
      { biomeId: 6, biomeName: 'Tropical Forest', blocks: [{ blockId: 1, blockName: 'Grass', weight: 0.8 }, { blockId: 7, blockName: 'Tree Seed', weight: 0.2 }], waterBlocks: [{ blockId: 6, blockName: 'Clear Water', weight: 1.0 }] },
      { biomeId: 7, biomeName: 'Temperate Forest', blocks: [{ blockId: 1, blockName: 'Grass', weight: 0.85 }, { blockId: 7, blockName: 'Tree Seed', weight: 0.15 }], waterBlocks: [{ blockId: 6, blockName: 'Clear Water', weight: 1.0 }] },
      { biomeId: 8, biomeName: 'Taiga', blocks: [{ blockId: 1, blockName: 'Grass', weight: 0.9 }, { blockId: 7, blockName: 'Tree Seed', weight: 0.1 }], waterBlocks: [{ blockId: 6, blockName: 'Clear Water', weight: 1.0 }] },
      { biomeId: 9, biomeName: 'Tundra', blocks: [{ blockId: 5, blockName: 'Snow', weight: 1.0 }], waterBlocks: [{ blockId: 6, blockName: 'Clear Water', weight: 1.0 }] },
      { biomeId: 10, biomeName: 'Rocky Mountain', blocks: [{ blockId: 3, blockName: 'Stone', weight: 1.0 }], waterBlocks: [{ blockId: 6, blockName: 'Clear Water', weight: 1.0 }] },
      { biomeId: 11, biomeName: 'Snow Peak', blocks: [{ blockId: 5, blockName: 'Snow', weight: 1.0 }], waterBlocks: [{ blockId: 6, blockName: 'Clear Water', weight: 1.0 }] },
      { biomeId: 12, biomeName: 'Alpine', blocks: [{ blockId: 5, blockName: 'Snow', weight: 0.7 }, { blockId: 3, blockName: 'Stone', weight: 0.3 }], waterBlocks: [{ blockId: 6, blockName: 'Clear Water', weight: 1.0 }] },
    ],
    waterBlockId: 6,
    useNoise1: true,
    noise1Influence: 1.0
  };

  async process(inputs, params) {
    const resolution = params.resolution || 512;
    const biomeMap = inputs.biomes;
    const waterMap = inputs.water;
    const heightMap = inputs.height;
    const noise1Map = inputs.noise1 || new Float32Array(resolution * resolution).fill(0.5);
    const biomeList = inputs.biomeList;

    if (!biomeMap || !waterMap || !heightMap) {
      throw new Error('BlockClassifier requires biomes, water, and height inputs');
    }

    const blocks = params.blocks || BlockClassifierNode.defaultParams.blocks;
    let biomeRules = params.biomeRules || BlockClassifierNode.defaultParams.biomeRules;
    const waterBlockId = params.waterBlockId || 6;
    
    // Sync biome names from biomeList if provided
    if (biomeList && Array.isArray(biomeList)) {
      biomeRules = biomeRules.map(rule => {
        const biome = biomeList.find(b => b.id === rule.biomeId);
        return {
          ...rule,
          biomeName: biome ? biome.name : rule.biomeName
        };
      });
    }

    console.log('Block classification (GPU):', { resolution, blocks: blocks.length, rules: biomeRules.length });

    // Load shader from file system (go up to project root)
    const shaderPath = path.join(__dirname, '../../../public/shaders/blockClassifier.wgsl');
    const shaderCode = await fs.readFile(shaderPath, 'utf-8');
    const shaderModule = this.device.createShaderModule({ code: shaderCode });

    // [REST OF THE GPU CODE IS IDENTICAL TO CLIENT - continuing...]
    
    // Prepare block data
    const blockData = new Float32Array(blocks.length * 8);
    blocks.forEach((block, i) => {
      const offset = i * 8;
      blockData[offset] = block.id;
      const color = this.hexToRgb(block.color);
      blockData[offset + 1] = color.r / 255;
      blockData[offset + 2] = color.g / 255;
      blockData[offset + 3] = color.b / 255;
      blockData[offset + 4] = 1.0;
      blockData[offset + 5] = block.transparent || 0;
      blockData[offset + 6] = block.emissive || 0;
      blockData[offset + 7] = block.reflective || 0;
    });

    // Prepare biome rules
    const biomeRuleData = new Uint32Array(biomeRules.length * 8);
    const blockWeights = [];
    
    biomeRules.forEach((rule, i) => {
      const offset = i * 8;
      const terrainBlocks = rule.blocks || [];
      const waterBlocks = rule.waterBlocks || [];
      
      biomeRuleData[offset] = rule.biomeId;
      biomeRuleData[offset + 1] = terrainBlocks.length;
      biomeRuleData[offset + 2] = blockWeights.length / 4;
      biomeRuleData[offset + 3] = waterBlocks.length;
      
      terrainBlocks.forEach(b => blockWeights.push(b.blockId, b.weight, 0, 0));
      biomeRuleData[offset + 4] = blockWeights.length / 4;
      waterBlocks.forEach(b => blockWeights.push(b.blockId, b.weight, 0, 0));
      
      biomeRuleData[offset + 5] = 0;
      biomeRuleData[offset + 6] = 0;
      biomeRuleData[offset + 7] = 0;
    });

    const blockWeightData = new ArrayBuffer(blockWeights.length * 4);
    const u32View = new Uint32Array(blockWeightData);
    const f32View = new Float32Array(blockWeightData);
    
    for (let i = 0; i < blockWeights.length; i += 4) {
      u32View[i] = blockWeights[i];
      f32View[i + 1] = blockWeights[i + 1];
      u32View[i + 2] = 0;
      u32View[i + 3] = 0;
    }

    // Create buffers
    const paramsData = new Uint32Array([resolution, blocks.length, biomeRules.length, params.useNoise1 ? 1 : 0, 0, waterBlockId, 0, 0]);
    new Float32Array(paramsData.buffer)[4] = params.noise1Influence || 1.0;

    const paramsBuffer = this.device.createBuffer({ size: paramsData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(paramsBuffer, 0, paramsData);

    const blocksBuffer = this.device.createBuffer({ size: blockData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(blocksBuffer, 0, blockData);

    const biomeRulesBuffer = this.device.createBuffer({ size: biomeRuleData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(biomeRulesBuffer, 0, biomeRuleData);

    const blockWeightsBuffer = this.device.createBuffer({ size: Math.max(blockWeightData.byteLength, 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(blockWeightsBuffer, 0, blockWeightData);

    const biomeMapU32 = new Uint32Array(biomeMap.length);
    for (let i = 0; i < biomeMap.length; i++) biomeMapU32[i] = biomeMap[i];

    const biomeMapBuffer = this.device.createBuffer({ size: biomeMapU32.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(biomeMapBuffer, 0, biomeMapU32);

    const waterMapBuffer = this.device.createBuffer({ size: waterMap.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(waterMapBuffer, 0, waterMap);

    const heightMapBuffer = this.device.createBuffer({ size: heightMap.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(heightMapBuffer, 0, heightMap);

    const noise1MapBuffer = this.device.createBuffer({ size: noise1Map.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(noise1MapBuffer, 0, noise1Map);

    const blockDataBuffer = this.device.createBuffer({ size: resolution * resolution * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });

    // Create pipeline
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    const bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: blocksBuffer } },
        { binding: 2, resource: { buffer: biomeRulesBuffer } },
        { binding: 3, resource: { buffer: blockWeightsBuffer } },
        { binding: 4, resource: { buffer: biomeMapBuffer } },
        { binding: 5, resource: { buffer: waterMapBuffer } },
        { binding: 6, resource: { buffer: heightMapBuffer } },
        { binding: 7, resource: { buffer: noise1MapBuffer } },
        { binding: 8, resource: { buffer: blockDataBuffer } },
      ],
    });

    const pipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    // Execute
    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(Math.ceil(resolution / 8), Math.ceil(resolution / 8));
    passEncoder.end();

    const blockReadBuffer = this.device.createBuffer({ size: resolution * resolution * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    commandEncoder.copyBufferToBuffer(blockDataBuffer, 0, blockReadBuffer, 0, resolution * resolution * 8);

    this.device.queue.submit([commandEncoder.finish()]);

    // Read back
    await blockReadBuffer.mapAsync(GPUMapMode.READ);
    const interleavedData = new Uint32Array(blockReadBuffer.getMappedRange());
    
    const terrainBlocks = new Uint16Array(resolution * resolution);
    const waterBlocks = new Uint16Array(resolution * resolution);
    for (let i = 0; i < resolution * resolution; i++) {
      terrainBlocks[i] = interleavedData[i * 2] & 0xFFFF;
      waterBlocks[i] = interleavedData[i * 2 + 1] & 0xFFFF;
    }
    blockReadBuffer.unmap();

    // Cleanup
    paramsBuffer.destroy();
    blocksBuffer.destroy();
    biomeRulesBuffer.destroy();
    blockWeightsBuffer.destroy();
    biomeMapBuffer.destroy();
    waterMapBuffer.destroy();
    heightMapBuffer.destroy();
    noise1MapBuffer.destroy();
    blockDataBuffer.destroy();
    blockReadBuffer.destroy();

    console.log(`Block classification complete (GPU)`);

    return {
      terrainBlocks,
      waterBlocks,
      blockMapVis: new Uint8ClampedArray(resolution * resolution * 4) // Dummy for now
    };
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
