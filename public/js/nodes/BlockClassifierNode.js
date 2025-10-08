import { BaseNode } from './BaseNode.js';

export class BlockClassifierNode extends BaseNode {
  static inputs = ['biomes', 'water', 'height', 'noise1', 'biomeList'];
  static outputs = ['terrainBlocks', 'waterBlocks', 'blockMapVis'];
  static defaultParams = {
    blocks: [
      { id: 0, name: 'Air', color: '#000000', transparent: 1.0, emissive: 0.0, reflective: 0.0, refractive: 1.0 },
      { id: 1, name: 'Grass', color: '#45b545', transparent: 0.0, emissive: 0.0, reflective: 0.0, refractive: 1.0 },
      { id: 2, name: 'Dirt', color: '#8b5a3c', transparent: 0.0, emissive: 0.0, reflective: 0.0, refractive: 1.0 },
      { id: 3, name: 'Stone', color: '#808080', transparent: 0.0, emissive: 0.0, reflective: 0.0, refractive: 1.0 },
      { id: 4, name: 'Sand', color: '#edc9af', transparent: 0.0, emissive: 0.0, reflective: 0.0, refractive: 1.0 },
      { id: 5, name: 'Snow', color: '#ffffff', transparent: 0.0, emissive: 0.0, reflective: 0.3, refractive: 1.0 },
      { id: 6, name: 'Water', color: '#1e90ff', transparent: 0.8, emissive: 0.0, reflective: 0.2, refractive: 1.33 },
      { id: 7, name: 'Tree Seed', color: '#228b22', transparent: 0.0, emissive: 0.0, reflective: 0.0, refractive: 1.0 },
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
    const biomeList = inputs.biomeList; // Optional biome metadata from BiomeClassifier

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
    const startTime = performance.now();

    // Load shader
    const shaderCode = await fetch('/shaders/blockClassifier.wgsl').then(r => r.text());
    const shaderModule = this.gpu.device.createShaderModule({ code: shaderCode });

    // Prepare block data
    const blockData = new Float32Array(blocks.length * 8); // 4 vec4s per block
    blocks.forEach((block, i) => {
      const offset = i * 8;
      blockData[offset] = block.id;
      // Color
      const color = this.hexToRgb(block.color);
      blockData[offset + 1] = color.r / 255;
      blockData[offset + 2] = color.g / 255;
      blockData[offset + 3] = color.b / 255;
      blockData[offset + 4] = 1.0; // Alpha
      // Properties
      blockData[offset + 5] = block.transparent || 0;
      blockData[offset + 6] = block.emissive || 0;
      blockData[offset + 7] = block.reflective || 0;
    });

    // Prepare biome rules and weights
    const biomeRuleData = new Uint32Array(biomeRules.length * 8); // 8 u32s per rule
    const blockWeights = [];
    
    biomeRules.forEach((rule, i) => {
      const offset = i * 8;
      const terrainBlocks = rule.blocks || [];
      const waterBlocks = rule.waterBlocks || [];
      
      biomeRuleData[offset] = rule.biomeId;
      biomeRuleData[offset + 1] = terrainBlocks.length;
      biomeRuleData[offset + 2] = blockWeights.length / 4; // Terrain start index (in struct units)
      biomeRuleData[offset + 3] = waterBlocks.length;
      
      // Add terrain block weights
      terrainBlocks.forEach(b => {
        blockWeights.push(b.blockId, b.weight, 0, 0); // Padding for alignment
      });
      
      biomeRuleData[offset + 4] = blockWeights.length / 4; // Water start index (in struct units)
      
      // Add water block weights
      waterBlocks.forEach(b => {
        blockWeights.push(b.blockId, b.weight, 0, 0); // Padding for alignment
      });
      
      // Padding (3 u32s)
      biomeRuleData[offset + 5] = 0;
      biomeRuleData[offset + 6] = 0;
      biomeRuleData[offset + 7] = 0;
    });

    // Create properly typed buffer: [u32 blockId, f32 weight, u32 pad, u32 pad] per entry
    const blockWeightData = new ArrayBuffer(blockWeights.length * 4);
    const u32View = new Uint32Array(blockWeightData);
    const f32View = new Float32Array(blockWeightData);
    
    for (let i = 0; i < blockWeights.length; i += 4) {
      u32View[i] = blockWeights[i];       // blockId as u32
      f32View[i + 1] = blockWeights[i + 1]; // weight as f32
      u32View[i + 2] = 0;                  // padding
      u32View[i + 3] = 0;                  // padding
    }
    
    // Debug: Log buffer data
    console.log('Biome rules buffer:', {
      numRules: biomeRules.length,
      rule0: {
        biomeId: biomeRuleData[0],
        numTerrainBlocks: biomeRuleData[1],
        terrainStartIdx: biomeRuleData[2],
        numWaterBlocks: biomeRuleData[3],
        waterStartIdx: biomeRuleData[4]
      },
      rule1: {
        biomeId: biomeRuleData[8],
        numTerrainBlocks: biomeRuleData[9],
        terrainStartIdx: biomeRuleData[10],
        numWaterBlocks: biomeRuleData[11],
        waterStartIdx: biomeRuleData[12]
      },
      allBiomeIds: Array.from(biomeRuleData).filter((_, i) => i % 8 === 0)
    });
    console.log('Block weights buffer:', {
      totalEntries: blockWeights.length / 4,
      allWeights: blockWeights,
      first3Structs: [
        { blockId: blockWeights[0], weight: blockWeights[1] },
        { blockId: blockWeights[4], weight: blockWeights[5] },
        { blockId: blockWeights[8], weight: blockWeights[9] }
      ]
    });
    console.log('Sample biome map values:', {
      sample: biomeMap.slice(100000, 100010),
      uniqueIds: [...new Set(biomeMap)].sort((a,b) => a-b)
    });
    console.log('CRITICAL DEBUG:');
    console.log('  Unique biome IDs in map:', [...new Set(biomeMap)].sort((a,b) => a-b));
    console.log('  All biome rule IDs:', Array.from(biomeRuleData).filter((_, i) => i % 8 === 0));
    console.log('  Rule 0: biomeId', biomeRuleData[0], 'terrainBlocks', biomeRuleData[1], 'at index', biomeRuleData[2]);
    console.log('  Rule 1: biomeId', biomeRuleData[8], 'terrainBlocks', biomeRuleData[9], 'at index', biomeRuleData[10]);
    console.log('  Block weight buffer (properly typed):');
    console.log('    Entry 0: blockId=', u32View[0], 'weight=', f32View[1]);
    console.log('    Entry 1: blockId=', u32View[4], 'weight=', f32View[5]);
    console.log('    Buffer size:', blockWeightData.byteLength, 'bytes');

    // Create buffers
    const paramsData = new Uint32Array([
      resolution,
      blocks.length,
      biomeRules.length,
      params.useNoise1 ? 1 : 0,
      0, // noise1Influence as float, will set below
      waterBlockId,
      0, 0 // padding
    ]);
    new Float32Array(paramsData.buffer)[4] = params.noise1Influence || 1.0;

    const paramsBuffer = this.gpu.device.createBuffer({
      size: paramsData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(paramsBuffer, 0, paramsData);

    const blocksBuffer = this.gpu.device.createBuffer({
      size: blockData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(blocksBuffer, 0, blockData);

    const biomeRulesBuffer = this.gpu.device.createBuffer({
      size: biomeRuleData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(biomeRulesBuffer, 0, biomeRuleData);

    const blockWeightsBuffer = this.gpu.device.createBuffer({
      size: Math.max(blockWeightData.byteLength, 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(blockWeightsBuffer, 0, blockWeightData);

    // Convert biomeMap from Uint8Array to Uint32Array for GPU
    const biomeMapU32 = new Uint32Array(biomeMap.length);
    for (let i = 0; i < biomeMap.length; i++) {
      biomeMapU32[i] = biomeMap[i];
    }

    const biomeMapBuffer = this.gpu.device.createBuffer({
      size: biomeMapU32.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(biomeMapBuffer, 0, biomeMapU32);

    const waterMapBuffer = this.gpu.device.createBuffer({
      size: waterMap.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(waterMapBuffer, 0, waterMap);

    const heightMapBuffer = this.gpu.device.createBuffer({
      size: heightMap.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(heightMapBuffer, 0, heightMap);

    const noise1MapBuffer = this.gpu.device.createBuffer({
      size: noise1Map.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(noise1MapBuffer, 0, noise1Map);

    // Interleaved buffer: vec2<u32> per pixel [terrain, water]
    const blockDataBuffer = this.gpu.device.createBuffer({
      size: resolution * resolution * 8, // 2 x Uint32 per pixel
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
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
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    const bindGroup = this.gpu.device.createBindGroup({
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

    const pipeline = this.gpu.device.createComputePipeline({
      layout: this.gpu.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    // Execute
    const commandEncoder = this.gpu.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(Math.ceil(resolution / 8), Math.ceil(resolution / 8));
    passEncoder.end();

    // Read back interleaved results
    const blockReadBuffer = this.gpu.device.createBuffer({
      size: resolution * resolution * 8, // vec2<u32> per pixel
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    commandEncoder.copyBufferToBuffer(blockDataBuffer, 0, blockReadBuffer, 0, resolution * resolution * 8);

    this.gpu.device.queue.submit([commandEncoder.finish()]);

    // Map and read interleaved data
    await blockReadBuffer.mapAsync(GPUMapMode.READ);
    const interleavedData = new Uint32Array(blockReadBuffer.getMappedRange());
    
    // De-interleave into separate arrays
    const terrainBlocks = new Uint16Array(resolution * resolution);
    const waterBlocks = new Uint16Array(resolution * resolution);
    for (let i = 0; i < resolution * resolution; i++) {
      terrainBlocks[i] = interleavedData[i * 2] & 0xFFFF;     // Even indices = terrain
      waterBlocks[i] = interleavedData[i * 2 + 1] & 0xFFFF;   // Odd indices = water
    }
    blockReadBuffer.unmap();

    // Debug: Check data
    console.log('Block data extracted:', {
      terrainSample: terrainBlocks.slice(0, 10),
      waterSample: waterBlocks.slice(0, 10),
      terrainNonZero: terrainBlocks.filter(v => v > 0).length,
      waterNonZero: waterBlocks.filter(v => v > 0).length
    });

    // Create visualization
    const blockMapVis = this.createVisualization(terrainBlocks, waterBlocks, blocks, resolution);
    
    console.log('Visualization created:', {
      length: blockMapVis.length,
      sample: blockMapVis.slice(0, 20)
    });

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

    const endTime = performance.now();
    console.log(`Block classification complete (GPU) in ${(endTime - startTime).toFixed(2)}ms`);

    return {
      output: blockMapVis,  // Primary output for preview
      terrainBlocks: terrainBlocks,
      waterBlocks: waterBlocks,
      blockMapVis: blockMapVis
    };
  }

  createVisualization(terrainBlocks, waterBlocks, blocks, resolution) {
    const vis = new Uint8ClampedArray(resolution * resolution * 4);
    
    // Create block color lookup
    const blockColors = new Map();
    blocks.forEach(block => {
      const rgb = this.hexToRgb(block.color);
      blockColors.set(block.id, rgb);
    });

    for (let i = 0; i < terrainBlocks.length; i++) {
      const terrainId = terrainBlocks[i];
      const waterId = waterBlocks[i];
      
      const idx = i * 4;
      
      // If water present, blend water color over terrain
      if (waterId > 0 && blockColors.has(waterId)) {
        const waterColor = blockColors.get(waterId);
        const terrainColor = blockColors.get(terrainId) || { r: 0, g: 0, b: 0 };
        
        // Simple blend (water transparency = 0.6)
        const alpha = 0.6;
        vis[idx] = Math.floor(waterColor.r * alpha + terrainColor.r * (1 - alpha));
        vis[idx + 1] = Math.floor(waterColor.g * alpha + terrainColor.g * (1 - alpha));
        vis[idx + 2] = Math.floor(waterColor.b * alpha + terrainColor.b * (1 - alpha));
        vis[idx + 3] = 255;
      } else if (blockColors.has(terrainId)) {
        const color = blockColors.get(terrainId);
        vis[idx] = color.r;
        vis[idx + 1] = color.g;
        vis[idx + 2] = color.b;
        vis[idx + 3] = 255;
      } else {
        // Unknown block - magenta
        vis[idx] = 255;
        vis[idx + 1] = 0;
        vis[idx + 2] = 255;
        vis[idx + 3] = 255;
      }
    }

    return vis;
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
