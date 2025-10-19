/**
 * Stream Chunk Generator
 * Extracts 32x32x32 SVDAG chunks from super chunk data
 */

import fs from 'fs/promises';
import path from 'path';
import { SVDAGBuilder } from './svdagBuilder.js';

export class StreamChunkGenerator {
  constructor(superChunkGenerator) {
    this.superChunkGenerator = superChunkGenerator;
    this.svdagBuilder = new SVDAGBuilder();
    this.cacheDir = 'storage/worlds';
  }
  
  /**
   * Generate a stream chunk (32x32x32 SVDAG)
   * @param {string} worldId - World identifier
   * @param {number} cx - Stream chunk X coordinate
   * @param {number} cy - Stream chunk Y coordinate
   * @param {number} cz - Stream chunk Z coordinate
   * @param {object} graph - World graph for generation
   * @param {object} config - World configuration
   * @returns {Promise<object>} Stream chunk data (material SVDAG, opaque SVDAG)
   */
  async generate(worldId, cx, cy, cz, graph, config) {
    // Only log debug chunk generation
    if (cx === 0 && cy === 4 && cz === 0) {
      console.log(`\n📦 Generating DEBUG chunk (${cx}, ${cy}, ${cz})...`);
    }
    const startTime = Date.now();
    
    // 1. Check cache first
    const cached = await this.loadFromCache(worldId, cx, cy, cz);
    if (cached) {
      return cached;
    }
    
    // 2. Determine which super chunk this belongs to
    const sx = Math.floor(cx / 16);
    const sz = Math.floor(cz / 16);
    
    // 3. Get or generate super chunk
    const superChunk = await this.superChunkGenerator.generate(worldId, sx, sz, graph, config);
    
    // 4. Extract 32x32x32 voxel region from super chunk
    const voxelGrid = this.extractVoxelRegion(superChunk, cx, cy, cz, config);
    
    // 5. Build material SVDAG
    const materialSVDAG = this.svdagBuilder.build(voxelGrid, 32);
    
    // 6. Build opaque SVDAG (for shadow casting)
    const opaqueGrid = this.makeOpaqueGrid(voxelGrid, config.materials);
    const opaqueSVDAG = this.svdagBuilder.build(opaqueGrid, 32, { buildOpaque: true });
    
    // 7. Create chunk data
    const streamChunk = {
      position: [cx, cy, cz],
      materialSVDAG,
      opaqueSVDAG,
      metadata: {
        cx, cy, cz, sx, sz,
        generatedAt: Date.now(),
        generationTime: Date.now() - startTime
      }
    };
    
    // 8. Cache results
    await this.saveToCache(worldId, cx, cy, cz, streamChunk);
    
    console.log(`✅ Stream chunk generated in ${Date.now() - startTime}ms`);
    return streamChunk;
  }
  
  /**
   * Generate test patterns for validation
   */
  generateTestPattern(voxelGrid, cx, cy, cz, pattern) {
    const chunkSize = 32;
    
    switch (pattern) {
      case 'FLAT_WORLD':
        // Completely flat world at y=0, single block type (grass)
        // Only generate for chunks at Y=4 (world height 128)
        if (cy === 4) {
          // CRITICAL: Fill ONLY y=0, nothing else!
          let written = 0;
          for (let z = 0; z < chunkSize; z++) {
            for (let x = 0; x < chunkSize; x++) {
              const y = 0; // ONLY the bottom layer!
              const voxelIdx = z * chunkSize * chunkSize + y * chunkSize + x;
              voxelGrid[voxelIdx] = 1; // All grass
              written++;
            }
          }
        }
        break;
        
      case 'CHECKERBOARD':
        // Checkerboard pattern at y=0
        if (cy === 4) {
          for (let z = 0; z < chunkSize; z++) {
            for (let x = 0; x < chunkSize; x++) {
              const voxelIdx = z * chunkSize * chunkSize + 0 * chunkSize + x; // y=0
              // Global checkerboard pattern across all chunks
              const worldX = cx * chunkSize + x;
              const worldZ = cz * chunkSize + z;
              if ((worldX + worldZ) % 2 === 0) {
                voxelGrid[voxelIdx] = 1; // Grass (green)
              } else {
                voxelGrid[voxelIdx] = 4; // Sand (tan)
              }
            }
          }
        }
        break;
        
      case 'STRIPES':
        // Vertical stripes (alternating by X coordinate)
        if (cy === 4) {
          for (let z = 0; z < chunkSize; z++) {
            for (let x = 0; x < chunkSize; x++) {
              const voxelIdx = z * chunkSize * chunkSize + 0 * chunkSize + x;
              const worldX = cx * chunkSize + x;
              // 4-voxel wide stripes
              const stripeId = Math.floor(worldX / 4) % 2;
              voxelGrid[voxelIdx] = stripeId === 0 ? 1 : 4;
            }
          }
        }
        break;
        
      case 'STEPS':
        // Staircase pattern - height increases with X
        const baseY = 4; // Start at chunk Y=4 (world y=128)
        if (cy >= 4 && cy <= 6) {
          for (let z = 0; z < chunkSize; z++) {
            for (let x = 0; x < chunkSize; x++) {
              const worldX = cx * chunkSize + x;
              // Each 8 voxels in X, step up by 1
              const stepHeight = Math.floor(worldX / 8);
              const targetY = 128 + stepHeight; // World Y
              
              // Fill from bottom of this chunk up to target height
              for (let y = 0; y < chunkSize; y++) {
                const worldY = cy * chunkSize + y;
                if (worldY <= targetY) {
                  const voxelIdx = z * chunkSize * chunkSize + y * chunkSize + x;
                  voxelGrid[voxelIdx] = 6; // Stone
                }
              }
            }
          }
        }
        break;
        
      case 'WATER_POND':
        // Flat grass world with water ponds to test dual-DAG transparency
        if (cy === 4) {
          // Layer 0: Grass base (everywhere)
          for (let z = 0; z < chunkSize; z++) {
            for (let x = 0; x < chunkSize; x++) {
              const voxelIdx = z * chunkSize * chunkSize + 0 * chunkSize + x;
              voxelGrid[voxelIdx] = 1; // Grass
            }
          }
          
          // Create circular ponds every 64 blocks
          const worldCenterX = cx * chunkSize + 16;
          const worldCenterZ = cz * chunkSize + 16;
          
          // Check if this chunk should have a pond center
          const pondSpacing = 64;
          const nearestPondX = Math.round(worldCenterX / pondSpacing) * pondSpacing;
          const nearestPondZ = Math.round(worldCenterZ / pondSpacing) * pondSpacing;
          
          // Add water layers 1-3 (3 blocks deep) in circular ponds
          for (let z = 0; z < chunkSize; z++) {
            for (let x = 0; x < chunkSize; x++) {
              const worldX = cx * chunkSize + x;
              const worldZ = cz * chunkSize + z;
              
              // Distance from nearest pond center
              const dx = worldX - nearestPondX;
              const dz = worldZ - nearestPondZ;
              const distSq = dx * dx + dz * dz;
              const pondRadius = 20; // 20 block radius
              
              if (distSq <= pondRadius * pondRadius) {
                // Inside pond - add water layers
                for (let y = 1; y <= 3; y++) { // Water at y=1,2,3
                  const voxelIdx = z * chunkSize * chunkSize + y * chunkSize + x;
                  voxelGrid[voxelIdx] = 6; // Water (material ID 6)
                }
              }
            }
          }
        }
        break;
    }
    
    return voxelGrid;
  }
  
  /**
   * Extract 32x32x32 voxel grid from super chunk data
   */
  extractVoxelRegion(superChunk, cx, cy, cz, config) {
    const chunkSize = 32;
    const voxelGrid = new Uint32Array(chunkSize * chunkSize * chunkSize);
    
    // ========================================================================
    // 🧪 TEST WORLD MODE - Predictable patterns for validation
    // ========================================================================
    const TEST_MODE = true;  // Set to true for testing
    const TEST_PATTERN = 'WATER_POND';  // Options: 'FLAT_WORLD', 'CHECKERBOARD', 'STRIPES', 'STEPS', 'WATER_POND'
    
    if (TEST_MODE) {
      return this.generateTestPattern(voxelGrid, cx, cy, cz, TEST_PATTERN);
    }
    
    // Convert stream chunk coord to voxel position
    const voxelX = cx * chunkSize;
    const voxelY = cy * chunkSize;
    const voxelZ = cz * chunkSize;
    
    // Which super chunk does this belong to?
    const sx = Math.floor(cx / 16);
    const sz = Math.floor(cz / 16);
    
    // Local position within super chunk (0-511)
    const localX = voxelX - sx * 512;
    const localZ = voxelZ - sz * 512;
    
    // Extract voxel data
    for (let z = 0; z < chunkSize; z++) {
      for (let x = 0; x < chunkSize; x++) {
        // Sample from super chunk 2D maps
        const superX = Math.min(localX + x, 511);
        const superZ = Math.min(localZ + z, 511);
        const superIdx = superZ * 512 + superX;
        
        const terrainHeightNormalized = superChunk.heightMap[superIdx]; // 0.0 - 1.0
        const blockType = superChunk.blockMap[superIdx];
        const hasRiver = superChunk.riverMap[superIdx] > 0;
        
        // Scale heightmap to world coordinates (0-1 -> 0-256 for example)
        const maxWorldHeight = 256; // Maximum world height
        const terrainHeight = terrainHeightNormalized * maxWorldHeight;
        const seaLevel = 0.5 * maxWorldHeight; // Sea level at 0.5
        
        // Fill vertical column
        for (let y = 0; y < chunkSize; y++) {
          const worldY = voxelY + y;
          const voxelIdx = z * chunkSize * chunkSize + y * chunkSize + x;
          
          // Determine voxel type based on world height
          if (worldY < terrainHeight) {
            // Solid terrain - use block type from BlockClassifier
            voxelGrid[voxelIdx] = blockType || 1;
          } else if (worldY < seaLevel) {
            // Below sea level = water
            voxelGrid[voxelIdx] = 6; // Water block ID
          } else if (hasRiver && worldY < terrainHeight + 5) {
            // Water layer above river
            voxelGrid[voxelIdx] = 6; // Water block ID
          } else {
            // Air
            voxelGrid[voxelIdx] = 0;
          }
        }
      }
    }
    
    return voxelGrid;
  }
  
  /**
   * Create opaque voxel grid (transparent blocks = air)
   */
  makeOpaqueGrid(voxelGrid, materials) {
    const opaqueGrid = new Uint32Array(voxelGrid.length);
    
    // Get transparent material IDs
    const transparentIds = new Set();
    if (materials) {
      for (const material of materials) {
        if (material.transparent && material.transparent > 0.5) {
          transparentIds.add(material.id);
        }
      }
    } else {
      // Default: water is transparent
      transparentIds.add(6);
    }
    
    // Copy, replacing transparent with air
    for (let i = 0; i < voxelGrid.length; i++) {
      const blockId = voxelGrid[i];
      if (blockId !== 0 && !transparentIds.has(blockId)) {
        opaqueGrid[i] = blockId;
      } else {
        opaqueGrid[i] = 0;
      }
    }
    
    return opaqueGrid;
  }
  
  /**
   * Load stream chunk from cache
   */
  async loadFromCache(worldId, cx, cy, cz) {
    try {
      const filePath = path.join(this.cacheDir, worldId, 'chunks', `${cx}_${cy}_${cz}.svdag`);
      const buffer = await fs.readFile(filePath);
      
      // Decode binary SVDAG format
      return this.decodeSVDAGChunk(buffer);
    } catch (err) {
      return null; // Not cached
    }
  }
  
  /**
   * Save stream chunk to cache
   */
  async saveToCache(worldId, cx, cy, cz, streamChunk) {
    const dir = path.join(this.cacheDir, worldId, 'chunks');
    await fs.mkdir(dir, { recursive: true });
    
    // Encode to binary format
    const buffer = this.encodeSVDAGChunk(streamChunk);
    
    const filePath = path.join(dir, `${cx}_${cy}_${cz}.svdag`);
    await fs.writeFile(filePath, buffer);
  }
  
  /**
   * Encode stream chunk to binary SVDAG format
   * Format: See CHUNK_FORMAT_SPECIFICATION.md
   */
  encodeSVDAGChunk(streamChunk) {
    const { materialSVDAG, opaqueSVDAG, position } = streamChunk;
    
    // Calculate sizes
    const headerSize = 40; // Extended header for dual SVDAG
    const matNodesSize = materialSVDAG.nodesBuffer.byteLength;
    const matLeavesSize = materialSVDAG.leavesBuffer.byteLength;
    const opqNodesSize = opaqueSVDAG.nodesBuffer.byteLength;
    const opqLeavesSize = opaqueSVDAG.leavesBuffer.byteLength;
    
    const totalSize = headerSize + matNodesSize + matLeavesSize + opqNodesSize + opqLeavesSize;
    
    const buffer = Buffer.alloc(totalSize);
    let offset = 0;
    
    // Write header
    buffer.writeUInt32LE(0x53564441, offset); offset += 4; // Magic: 'SVDA'
    buffer.writeUInt32LE(2, offset); offset += 4; // Version 2 (dual SVDAG)
    buffer.writeUInt32LE(32, offset); offset += 4; // Chunk size
    buffer.writeUInt32LE(materialSVDAG.nodeCount, offset); offset += 4;
    buffer.writeUInt32LE(materialSVDAG.leafCount, offset); offset += 4;
    buffer.writeUInt32LE(materialSVDAG.rootIdx, offset); offset += 4;
    buffer.writeUInt32LE(0x1, offset); offset += 4; // Flags: hasOpaque
    buffer.writeUInt32LE(0, offset); offset += 4; // Checksum (TODO)
    buffer.writeUInt32LE(opaqueSVDAG.rootIdx, offset); offset += 4;
    buffer.writeUInt32LE(opaqueSVDAG.nodeCount, offset); offset += 4;
    
    // Write material nodes (use byteOffset and byteLength to avoid copying whole underlying buffer)
    const matNodesView = Buffer.from(
      materialSVDAG.nodesBuffer.buffer,
      materialSVDAG.nodesBuffer.byteOffset,
      materialSVDAG.nodesBuffer.byteLength
    );
    matNodesView.copy(buffer, offset);
    offset += matNodesSize;
    
    // Write material leaves
    const matLeavesView = Buffer.from(
      materialSVDAG.leavesBuffer.buffer,
      materialSVDAG.leavesBuffer.byteOffset,
      materialSVDAG.leavesBuffer.byteLength
    );
    matLeavesView.copy(buffer, offset);
    offset += matLeavesSize;
    
    // Write opaque nodes
    const opqNodesView = Buffer.from(
      opaqueSVDAG.nodesBuffer.buffer,
      opaqueSVDAG.nodesBuffer.byteOffset,
      opaqueSVDAG.nodesBuffer.byteLength
    );
    opqNodesView.copy(buffer, offset);
    offset += opqNodesSize;
    
    // Write opaque leaves
    const opqLeavesView = Buffer.from(
      opaqueSVDAG.leavesBuffer.buffer,
      opaqueSVDAG.leavesBuffer.byteOffset,
      opaqueSVDAG.leavesBuffer.byteLength
    );
    opqLeavesView.copy(buffer, offset);
    
    return buffer;
  }
  
  /**
   * Decode binary SVDAG chunk
   */
  decodeSVDAGChunk(buffer) {
    let offset = 0;
    
    // Read header
    const magic = buffer.readUInt32LE(offset); offset += 4;
    if (magic !== 0x53564441) {
      throw new Error('Invalid SVDAG chunk: bad magic number');
    }
    
    const version = buffer.readUInt32LE(offset); offset += 4;
    const chunkSize = buffer.readUInt32LE(offset); offset += 4;
    const matNodeCount = buffer.readUInt32LE(offset); offset += 4;
    const matLeafCount = buffer.readUInt32LE(offset); offset += 4;
    const matRootIdx = buffer.readUInt32LE(offset); offset += 4;
    const flags = buffer.readUInt32LE(offset); offset += 4;
    const checksum = buffer.readUInt32LE(offset); offset += 4;
    const opqRootIdx = buffer.readUInt32LE(offset); offset += 4;
    const opqNodeCount = buffer.readUInt32LE(offset); offset += 4;
    
    // Read material nodes
    const matNodesSize = matNodeCount * 4; // Assuming 4 bytes per node entry
    const matNodesBuffer = new Uint32Array(buffer.buffer, buffer.byteOffset + offset, matNodeCount);
    offset += matNodesSize;
    
    // Read material leaves
    const matLeavesBuffer = new Uint32Array(buffer.buffer, buffer.byteOffset + offset, matLeafCount);
    offset += matLeafCount * 4;
    
    // Read opaque nodes
    const opqNodesSize = opqNodeCount * 4;
    const opqNodesBuffer = new Uint32Array(buffer.buffer, buffer.byteOffset + offset, opqNodeCount);
    offset += opqNodesSize;
    
    // Read opaque leaves
    const opqLeafCount = (buffer.length - offset) / 4;
    const opqLeavesBuffer = new Uint32Array(buffer.buffer, buffer.byteOffset + offset, opqLeafCount);
    
    return {
      materialSVDAG: {
        nodesBuffer: matNodesBuffer,
        leavesBuffer: matLeavesBuffer,
        rootIdx: matRootIdx,
        nodeCount: matNodeCount,
        leafCount: matLeafCount
      },
      opaqueSVDAG: {
        nodesBuffer: opqNodesBuffer,
        leavesBuffer: opqLeavesBuffer,
        rootIdx: opqRootIdx,
        nodeCount: opqNodeCount,
        leafCount: opqLeafCount
      },
      chunkSize,
      version
    };
  }
}
