/**
 * Chunk API Routes
 * Handles chunk generation and streaming
 */

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { StreamChunkGenerator } from '../services/streamChunkGenerator.js';
import { SuperChunkGenerator } from '../services/superChunkGenerator.js';
import { GraphExecutor } from '../services/graphExecutor.js';

const router = express.Router();

// Initialize services
const graphExecutor = new GraphExecutor();
const superChunkGenerator = new SuperChunkGenerator(graphExecutor);
const streamChunkGenerator = new StreamChunkGenerator(superChunkGenerator);

// Initialize on startup
await graphExecutor.initialize();

/**
 * GET /api/worlds/:worldId/chunks/:x/:y/:z
 * Get a single stream chunk (32x32x32 SVDAG)
 */
router.get('/worlds/:worldId/chunks/:x/:y/:z', async (req, res) => {
  try {
    const { worldId, x, y, z } = req.params;
    const cx = parseInt(x);
    const cy = parseInt(y);
    const cz = parseInt(z);
    
    console.log(`\n📦 Chunk request: ${worldId} (${cx}, ${cy}, ${cz})`);
    
    // Load world configuration
    const worldDir = path.join('storage', 'worlds', worldId);
    const graphPath = path.join(worldDir, 'graph.json');
    const configPath = path.join(worldDir, 'config.json');
    
    // Check if world exists
    try {
      await fs.access(worldDir);
    } catch {
      return res.status(404).json({ error: 'World not found' });
    }
    
    // Load graph and config
    let graph, config;
    try {
      const graphData = JSON.parse(await fs.readFile(graphPath, 'utf-8'));
      // Handle both direct graph and wrapped format
      graph = graphData.graph || graphData;
    } catch {
      // Fallback: generate default graph
      console.log('⚠️  No graph.json found, using default');
      graph = { nodes: [], connections: [] };
    }
    
    try {
      config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    } catch {
      // Fallback: use default config
      console.log('⚠️  No config.json found, using default');
      config = {
        seed: 12345,
        materials: [
          { id: 0, name: 'Air', color: [0, 0, 0], transparent: 1.0 },
          { id: 1, name: 'Stone', color: [0.5, 0.5, 0.5], transparent: 0.0 },
          { id: 2, name: 'Grass', color: [0.27, 0.71, 0.27], transparent: 0.0 },
          { id: 3, name: 'Dirt', color: [0.6, 0.4, 0.2], transparent: 0.0 },
          { id: 4, name: 'Sand', color: [0.9, 0.85, 0.6], transparent: 0.0 },
          { id: 5, name: 'Snow', color: [0.95, 0.95, 1.0], transparent: 0.0 },
          { id: 6, name: 'Water', color: [0.2, 0.4, 0.8], transparent: 0.7 }
        ],
        erosionIterations: 50
      };
    }
    
    // Generate chunk
    const startTime = Date.now();
    const chunk = await streamChunkGenerator.generate(worldId, cx, cy, cz, graph, config);
    const generationTime = Date.now() - startTime;
    
    // Encode to binary format
    const buffer = streamChunkGenerator.encodeSVDAGChunk(chunk);
    
    // Set headers
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Chunk-Size', '32');
    res.setHeader('X-Chunk-Position', `${cx},${cy},${cz}`);
    res.setHeader('X-Generation-Time', generationTime.toString());
    res.setHeader('X-Material-Nodes', chunk.materialSVDAG.nodeCount.toString());
    res.setHeader('X-Material-Leaves', chunk.materialSVDAG.leafCount.toString());
    res.setHeader('X-Opaque-Nodes', chunk.opaqueSVDAG.nodeCount.toString());
    res.setHeader('X-Opaque-Leaves', chunk.opaqueSVDAG.leafCount.toString());
    res.setHeader('Content-Length', buffer.length.toString());
    
    // Enable caching
    res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour
    res.setHeader('ETag', `"${worldId}-${cx}-${cy}-${cz}"`);
    
    console.log(`✅ Chunk sent: ${buffer.length} bytes in ${generationTime}ms`);
    
    res.send(buffer);
    
  } catch (error) {
    console.error('❌ Chunk generation error:', error);
    res.status(500).json({ 
      error: 'Chunk generation failed',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/worlds/:worldId/manifest
 * Get world manifest (materials, spawn point, etc.)
 */
router.get('/worlds/:worldId/manifest', async (req, res) => {
  try {
    const { worldId } = req.params;
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
      config = {
        seed: 12345,
        materials: [],
        spawnPoint: [0, 100, 0]
      };
    }
    
    // Build manifest
    const manifest = {
      worldId,
      seed: config.seed,
      chunkSize: 32,
      superChunkSize: 512,
      materials: config.materials || [],
      spawnPoint: config.spawnPoint || [0, 100, 0],
      version: 2
    };
    
    res.json(manifest);
    
  } catch (error) {
    console.error('❌ Manifest error:', error);
    res.status(500).json({ error: 'Failed to load manifest' });
  }
});

/**
 * POST /api/worlds/:worldId/invalidate-chunk
 * Invalidate a chunk's cache (force regeneration)
 */
router.post('/worlds/:worldId/invalidate-chunk', async (req, res) => {
  try {
    const { worldId } = req.params;
    const { x, y, z } = req.body;
    
    const chunkPath = path.join('storage', 'worlds', worldId, 'chunks', `${x}_${y}_${z}.svdag`);
    
    try {
      await fs.unlink(chunkPath);
      console.log(`🗑️  Invalidated chunk (${x}, ${y}, ${z})`);
      res.json({ success: true, message: 'Chunk invalidated' });
    } catch (error) {
      res.status(404).json({ error: 'Chunk not found or already invalidated' });
    }
    
  } catch (error) {
    res.status(500).json({ error: 'Failed to invalidate chunk' });
  }
});

/**
 * POST /api/worlds/:worldId/invalidate-superchunk
 * Invalidate a super chunk's cache (force regeneration of all contained chunks)
 */
router.post('/worlds/:worldId/invalidate-superchunk', async (req, res) => {
  try {
    const { worldId } = req.params;
    const { sx, sz } = req.body;
    
    const superChunkDir = path.join('storage', 'worlds', worldId, 'superchunks', `${sx}_${sz}`);
    
    try {
      await fs.rm(superChunkDir, { recursive: true });
      console.log(`🗑️  Invalidated super chunk (${sx}, ${sz})`);
      
      // Also invalidate all stream chunks in this super chunk
      const chunksDir = path.join('storage', 'worlds', worldId, 'chunks');
      const files = await fs.readdir(chunksDir);
      
      let deletedCount = 0;
      for (const file of files) {
        const match = file.match(/^(\d+)_(\d+)_(\d+)\.svdag$/);
        if (match) {
          const [_, cx, cy, cz] = match.map(Number);
          const chunkSx = Math.floor(cx / 16);
          const chunkSz = Math.floor(cz / 16);
          
          if (chunkSx === sx && chunkSz === sz) {
            await fs.unlink(path.join(chunksDir, file));
            deletedCount++;
          }
        }
      }
      
      res.json({ 
        success: true, 
        message: `Super chunk and ${deletedCount} stream chunks invalidated` 
      });
    } catch (error) {
      res.status(404).json({ error: 'Super chunk not found or already invalidated' });
    }
    
  } catch (error) {
    res.status(500).json({ error: 'Failed to invalidate super chunk' });
  }
});

export default router;
