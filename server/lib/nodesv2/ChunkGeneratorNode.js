import { BaseNode } from '../nodes/BaseNode.js';

/**
 * Chunk Generator Node - 32×32×32 voxels
 * Generates solid/air blocks from heightmap
 */
export class ChunkGeneratorNode extends BaseNode {
  static inputs = ['heightmap'];
  static outputs = ['voxels'];
  static defaultParams = {
    resolution: 512,  // Heightmap resolution
    chunkX: 0,
    chunkY: 0,
    chunkZ: 0,
    seaLevel: 128.0
  };

  async process(inputs, params) {
    const resolution = params.resolution || 512;
    const chunkX = params.chunkX || 0;
    const chunkY = params.chunkY || 0;
    const chunkZ = params.chunkZ || 0;
    const seaLevel = params.seaLevel || 128.0;
    const regionX = params.regionX || 0;
    const regionZ = params.regionZ || 0;

    const heightmapData = inputs.heightmap;

    // Create output buffer for 32³ voxels
    const voxelCount = 32 * 32 * 32;
    const outputSize = voxelCount * 4; // Uint32
    const outputBuffer = this.createDataBuffer(outputSize);

    // Upload heightmap
    const heightmapSize = resolution * resolution * 4;
    const heightmapBuffer = this.createDataBuffer(heightmapSize);
    this.device.queue.writeBuffer(heightmapBuffer, 0, heightmapData.buffer);

    const shaderCode = `
      struct Params {
        resolution: u32,
        chunkX: i32,
        chunkY: i32,
        chunkZ: i32,
        seaLevel: f32,
        regionX: i32,
        regionZ: i32,
      }

      @group(0) @binding(0) var<storage, read> heightmap: array<f32>;
      @group(0) @binding(1) var<storage, read_write> voxels: array<u32>;
      @group(0) @binding(2) var<uniform> params: Params;

      const BLOCK_AIR: u32 = 0u;
      const BLOCK_STONE: u32 = 1u;
      const BLOCK_DIRT: u32 = 2u;
      const BLOCK_GRASS: u32 = 3u;
      const BLOCK_WATER: u32 = 6u;

      fn sampleHeightmap(worldX: i32, worldZ: i32) -> f32 {
        // Convert world to heightmap coordinates
        let localX = worldX - params.regionX;
        let localZ = worldZ - params.regionZ;
        
        if (localX < 0 || localX >= i32(params.resolution) || 
            localZ < 0 || localZ >= i32(params.resolution)) {
          return 0.5; // Default height if out of bounds
        }
        
        let idx = u32(localZ) * params.resolution + u32(localX);
        return heightmap[idx];
      }

      @compute @workgroup_size(4, 4, 4)
      fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let localX = global_id.x;
        let localY = global_id.y;
        let localZ = global_id.z;
        
        if (localX >= 32u || localY >= 32u || localZ >= 32u) {
          return;
        }
        
        // World coordinates
        let worldX = params.chunkX * 32 + i32(localX);
        let worldY = params.chunkY * 32 + i32(localY);
        let worldZ = params.chunkZ * 32 + i32(localZ);
        
        // Sample heightmap (0-1 range)
        let heightNormalized = sampleHeightmap(worldX, worldZ);
        let surfaceHeight = heightNormalized * 256.0;
        
        // Determine block type
        var blockType: u32;
        
        let depth = surfaceHeight - f32(worldY);
        
        if (depth < 0.0) {
          // Above surface
          if (f32(worldY) < params.seaLevel) {
            blockType = BLOCK_WATER;
          } else {
            blockType = BLOCK_AIR;
          }
        } else {
          // Below surface (solid terrain)
          if (depth < 1.0) {
            blockType = BLOCK_GRASS; // Surface
          } else if (depth < 4.0) {
            blockType = BLOCK_DIRT;  // Subsurface
          } else {
            blockType = BLOCK_STONE; // Deep
          }
        }
        
        // Write to output
        let voxelIdx = localZ * 32u * 32u + localY * 32u + localX;
        voxels[voxelIdx] = blockType;
      }
    `;

    const workgroupsX = Math.ceil(32 / 4);
    const workgroupsY = Math.ceil(32 / 4);
    const workgroupsZ = Math.ceil(32 / 4);

    // Create shader module and pipeline
    const shaderModule = this.device.createShaderModule({ code: shaderCode });
    const pipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main'
      }
    });

    const uniformBuffer = this.createUniformBuffer({
      resolution,
      chunkX,
      chunkY,
      chunkZ,
      seaLevel,
      regionX,
      regionZ
    });

    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: heightmapBuffer } },
        { binding: 1, resource: { buffer: outputBuffer } },
        { binding: 2, resource: { buffer: uniformBuffer } }
      ]
    });

    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(workgroupsX, workgroupsY, workgroupsZ);
    passEncoder.end();
    this.device.queue.submit([commandEncoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();

    // Read back voxel data
    const stagingBuffer = this.device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    const copyEncoder = this.device.createCommandEncoder();
    copyEncoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, outputSize);
    this.device.queue.submit([copyEncoder.finish()]);

    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const voxels = new Uint32Array(stagingBuffer.getMappedRange().slice(0));
    stagingBuffer.unmap();

    // Cleanup
    heightmapBuffer.destroy();
    outputBuffer.destroy();
    uniformBuffer.destroy();
    stagingBuffer.destroy();

    console.log(`✅ Chunk generated (${chunkX}, ${chunkY}, ${chunkZ})`);
    return { voxels };
  }
}
