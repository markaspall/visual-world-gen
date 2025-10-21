/**
 * Chunk API Routes V2
 * Multi-resolution GPU pipeline
 */

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { create, globals } from 'webgpu';
import {
  BaseElevationNode,
  UpscaleNode
} from '../lib/nodesv2/index.js';
import { SVDAGBuilder } from '../services/svdagBuilder.js';

const router = express.Router();

// Defer V2 initialization to avoid conflicts with V1
// V1 initializes at module load, V2 initializes on first request
let device = null;
let nodes = null;
let initPromise = null;

async function ensureInitialized() {
  if (initPromise) return initPromise;
  
  initPromise = (async () => {
    console.log('🎮 Initializing WebGPU for V2 pipeline...');

    // Setup WebGPU globals
    if (!globalThis.GPUBufferUsage) {
      Object.assign(globalThis, globals);
    }
    const navigator = { gpu: create([]) };

    // Get GPU adapter and device
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      throw new Error('No GPU adapter found');
    }

    device = await adapter.requestDevice();
    console.log('✅ WebGPU device acquired');

    // Initialize nodes (minimal set - no chunk generator, using CPU fallback)
    nodes = {
      baseElevation: new BaseElevationNode(device),
      upscale: new UpscaleNode(device)
    };
    console.log('✅ V2 nodes initialized (LOD 0 + LOD 1 only)');
    
    // Keep process alive
    setInterval(() => {}, 30000);
    console.log('✅ V2 keep-alive enabled');
  })();
  
  return initPromise;
}

console.log('📦 V2 route loaded (will initialize on first request)');

// Keep process alive even before GPU init
// This prevents Node.js from exiting before first chunk request
setInterval(() => {}, 30000);
console.log('✅ V2 keep-alive timer started');

// In-memory region cache
const regionCache = new Map();

/**
 * Generate or retrieve region data (LOD 0 + LOD 1)
 */
// Simple CPU Perlin noise (no GPU)
function simplePerlin(x, y, seed) {
  // Very simple hash-based noise
  const hash = (n) => {
    n = Math.sin(n + seed) * 43758.5453123;
    return n - Math.floor(n);
  };
  
  const n = hash(x + y * 57.0);
  return n;
}

async function getRegion(regionX, regionZ, seed) {
  const regionKey = `${regionX}_${regionZ}_${seed}`;
  
  // Check cache first
  if (regionCache.has(regionKey)) {
    return regionCache.get(regionKey);
  }

  // console.log(`\n🌍 Generating region: (${regionX}, ${regionZ}) - CPU PIPELINE`);
  const startTime = Date.now();

  // Generate heightmap directly at 512×512 using CPU
  const heightmap = new Float32Array(512 * 512);
  
  // Helper: Smooth interpolation (smoothstep)
  const smoothstep = (t) => t * t * (3 - 2 * t);
  
  // Helper: 2D hash function for noise
  const hash2D = (x, y, seed) => {
    let h = seed + x * 374761393 + y * 668265263;
    h = (h ^ (h >>> 13)) * 1274126177;
    return (h ^ (h >>> 16)) & 0xFFFFFFFF;
  };
  
  // Helper: Get random value [0, 1] from grid point
  const getGridValue = (gx, gy) => {
    const h = hash2D(gx, gy, seed);
    return (h & 0xFFFF) / 0xFFFF;
  };
  
  // Bilinear interpolated noise
  const sampleNoise = (worldX, worldZ, scale) => {
    const x = worldX / scale;
    const z = worldZ / scale;
    
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const x1 = x0 + 1;
    const z1 = z0 + 1;
    
    const fx = x - x0;
    const fz = z - z0;
    
    // Get corner values
    const v00 = getGridValue(x0, z0);
    const v10 = getGridValue(x1, z0);
    const v01 = getGridValue(x0, z1);
    const v11 = getGridValue(x1, z1);
    
    // Smooth interpolation
    const sx = smoothstep(fx);
    const sz = smoothstep(fz);
    
    // Bilinear interpolation
    const v0 = v00 * (1 - sx) + v10 * sx;
    const v1 = v01 * (1 - sx) + v11 * sx;
    return v0 * (1 - sz) + v1 * sz;
  };
  
  // Generate heightmap with multiple octaves
  for (let z = 0; z < 512; z++) {
    for (let x = 0; x < 512; x++) {
      const worldX = regionX + x;
      const worldZ = regionZ + z;
      
      // Multi-octave noise (fractal)
      let height = 0;
      let amplitude = 1.0;
      let frequency = 1.0;
      let maxValue = 0;
      
      // 4 octaves for varied terrain
      for (let octave = 0; octave < 4; octave++) {
        const scale = 128.0 / frequency; // Base scale
        height += sampleNoise(worldX, worldZ, scale) * amplitude;
        maxValue += amplitude;
        
        amplitude *= 0.5;  // Each octave has half the amplitude
        frequency *= 2.0;  // Each octave has double the frequency
      }
      
      // Normalize to [0, 1]
      height /= maxValue;
      
      // Adjust range: 0.2 to 0.5 (height 51 to 128 in world units)
      height = 0.2 + height * 0.3;
      
      heightmap[z * 512 + x] = height;
    }
  }

  const regionData = {
    heightmap,
    resolution: 512
  };

  // Cache the region
  regionCache.set(regionKey, regionData);
  
  // Calculate height statistics
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  let avgHeight = 0;
  for (let i = 0; i < heightmap.length; i++) {
    const h = heightmap[i] * 256;
    minHeight = Math.min(minHeight, h);
    maxHeight = Math.max(maxHeight, h);
    avgHeight += h;
  }
  avgHeight /= heightmap.length;
  
  const elapsed = Date.now() - startTime;
  // console.log(`✅ Region generated in ${elapsed}ms (CPU)`);
  // console.log(`   ⛰️  Height range: ${minHeight.toFixed(1)} to ${maxHeight.toFixed(1)} (avg: ${avgHeight.toFixed(1)})`);

  return regionData;
}

/**
 * GET /api/v2/worlds/:worldId/chunks/:x/:y/:z
 * Get a single stream chunk (32x32x32 SVDAG) using V2 pipeline
 */
router.get('/worlds/:worldId/chunks/:x/:y/:z', async (req, res) => {
  // Wrap entire handler to catch sync GPU errors
  try {
    // No GPU initialization needed - using CPU pipeline
    
    const { worldId, x, y, z } = req.params;
    const cx = parseInt(x);
    const cy = parseInt(y);
    const cz = parseInt(z);
    
    // Only log chunks at (0, ?, 0) for debugging
    if (cx === 0 && cz === 0) {
      console.log(`\n📦 V2 Chunk request: ${worldId} (${cx}, ${cy}, ${cz})`);
    }
    
    // Load world configuration
    const worldDir = path.join('storage', 'worlds', worldId);
    const configPath = path.join(worldDir, 'config.json');
    
    // Check if world exists
    try {
      await fs.access(worldDir);
    } catch {
      return res.status(404).json({ error: 'World not found' });
    }
    
    // Load config
    let config;
    try {
      config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    } catch {
      // console.log('⚠️  No config.json found, using default');
      config = { seed: 12345 };
    }

    const seed = config.seed || 12345;
    
    // Determine which region this chunk belongs to
    const regionX = Math.floor((cx * 32) / 512) * 512;
    const regionZ = Math.floor((cz * 32) / 512) * 512;
    
    // Get or generate region
    const startTime = Date.now();
    const region = await getRegion(regionX, regionZ, seed);
    const regionTime = Date.now() - startTime;
    
    // Generate chunk voxels - FULL TERRAIN
    const chunkStart = Date.now();
    
    const voxels = new Uint32Array(32 * 32 * 32);
    
    // COLUMN TEST - 12x12 chunks wide, full height terrain
    let solidCount = 0;
    let airCount = 0;
    
    if (cx >= -6 && cx <= 5 && cz >= -6 && cz <= 5) {
      // Inside 12x12 column - generate terrain at all Y levels
      for (let voxZ = 0; voxZ < 32; voxZ++) {
        for (let voxX = 0; voxX < 32; voxX++) {
          const worldX = cx * 32 + voxX;
          const worldZ = cz * 32 + voxZ;
          
          const localX = worldX - regionX;
          const localZ = worldZ - regionZ;
          const clampedX = Math.max(0, Math.min(511, localX));
          const clampedZ = Math.max(0, Math.min(511, localZ));
          
          const heightIdx = clampedZ * 512 + clampedX;
          const heightValue = region.heightmap[heightIdx];
          const surfaceHeight = heightValue * 256;
          
          for (let y = 0; y < 32; y++) {
            const worldY = cy * 32 + y;
            const idx = voxZ * 32 * 32 + y * 32 + voxX; // Normal indexing - shader handles flip
            
            if (worldY < surfaceHeight) {
              voxels[idx] = 1; // Grass material
              solidCount++;
            } else {
              voxels[idx] = 0; // Air
              airCount++;
            }
          }
        }
      }
    } else {
      // Outside 12x12 column - all air
      airCount = 32 * 32 * 32;
    }
    
    const voxelData = { voxels };
    
    const chunkTime = Date.now() - chunkStart;
    
    // Build SVDAG
    const svdagStart = Date.now();
    
    const svdagBuilder = new SVDAGBuilder();
    const materialSVDAG = svdagBuilder.build(voxelData.voxels, 32);
    
    // For now, opaqueSVDAG is same as materialSVDAG (no transparency)
    const opaqueSVDAG = materialSVDAG;
    
    // Minimal logging for debug
    // (disabled for performance)
    
    // Encode chunk data
    const buffer = encodeSVDAGChunk({ materialSVDAG, opaqueSVDAG });
    
    const totalTime = Date.now() - startTime;
    
    // Set headers
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Chunk-Size', '32');
    res.setHeader('X-Chunk-Position', `${cx},${cy},${cz}`);
    res.setHeader('X-Generation-Time', totalTime.toString());
    res.setHeader('X-Pipeline-Version', 'v2');
    res.setHeader('X-Material-Nodes', materialSVDAG.nodeCount.toString());
    res.setHeader('X-Material-Leaves', materialSVDAG.leafCount.toString());
    res.setHeader('Content-Length', buffer.length.toString());
    res.setHeader('Cache-Control', 'public, max-age=3600');
    
    res.send(buffer);
    
  } catch (error) {
    console.error('❌ Error generating V2 chunk:', error);
    console.error('❌ Error message:', error.message);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      error: 'V2 chunk generation failed', 
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * POST /api/v2/worlds/:worldId/invalidate-region
 * Invalidate cached region
 */
router.post('/worlds/:worldId/invalidate-region', async (req, res) => {
  const { worldId } = req.params;
  const { regionX, regionZ } = req.body;
  
  // Load seed
  const worldDir = path.join('storage', 'worlds', worldId);
  const configPath = path.join(worldDir, 'config.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
  const seed = config.seed || 12345;
  
  const regionKey = `${regionX}_${regionZ}_${seed}`;
  
  if (regionCache.has(regionKey)) {
    regionCache.delete(regionKey);
    console.log(`🗑️  Invalidated region: (${regionX}, ${regionZ})`);
    res.json({ success: true, message: 'Region invalidated' });
  } else {
    res.json({ success: false, message: 'Region not in cache' });
  }
});

/**
 * Helper: Encode SVDAG chunk to binary (V1-compatible format)
 */
function encodeSVDAGChunk(chunk) {
  const { materialSVDAG, opaqueSVDAG } = chunk;

  // Calculate buffer size (40-byte header + data)
  const headerSize = 40;
  const materialNodesSize = materialSVDAG.nodesBuffer.byteLength;
  const materialLeavesSize = materialSVDAG.leavesBuffer.byteLength;
  const opaqueNodesSize = opaqueSVDAG.nodesBuffer.byteLength;
  const opaqueLeavesSize = opaqueSVDAG.leavesBuffer.byteLength;

  const totalSize = headerSize + materialNodesSize + materialLeavesSize + 
                   opaqueNodesSize + opaqueLeavesSize;

  const buffer = Buffer.alloc(totalSize);
  let offset = 0;

  // Write 40-byte header (V1-compatible)
  buffer.writeUInt32LE(0x53564441, offset); offset += 4; // Magic: 'SVDA'
  buffer.writeUInt32LE(2, offset); offset += 4;          // Version 2 (dual SVDAG)
  buffer.writeUInt32LE(32, offset); offset += 4;         // Chunk size
  buffer.writeUInt32LE(materialSVDAG.nodeCount, offset); offset += 4;
  buffer.writeUInt32LE(materialSVDAG.leafCount, offset); offset += 4;
  buffer.writeUInt32LE(materialSVDAG.rootIdx, offset); offset += 4;
  buffer.writeUInt32LE(0, offset); offset += 4;          // Flags (reserved)
  buffer.writeUInt32LE(0, offset); offset += 4;          // Checksum (not implemented)
  buffer.writeUInt32LE(opaqueSVDAG.rootIdx, offset); offset += 4;
  buffer.writeUInt32LE(opaqueSVDAG.nodeCount, offset); offset += 4;

  // Write material SVDAG nodes
  const matNodesBuffer = Buffer.from(materialSVDAG.nodesBuffer.buffer);
  matNodesBuffer.copy(buffer, offset);
  offset += materialNodesSize;

  // Write material SVDAG leaves
  const matLeavesBuffer = Buffer.from(materialSVDAG.leavesBuffer.buffer);
  matLeavesBuffer.copy(buffer, offset);
  offset += materialLeavesSize;

  // Write opaque SVDAG nodes
  const opqNodesBuffer = Buffer.from(opaqueSVDAG.nodesBuffer.buffer);
  opqNodesBuffer.copy(buffer, offset);
  offset += opaqueNodesSize;

  // Write opaque SVDAG leaves
  const opqLeavesBuffer = Buffer.from(opaqueSVDAG.leavesBuffer.buffer);
  opqLeavesBuffer.copy(buffer, offset);

  return buffer;
}

export default router;
