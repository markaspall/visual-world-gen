/**
 * Graph Executor - Server-side
 * Executes node graphs to generate terrain data
 * TODO: Port all 28 node types from client to server
 */

import { create, globals } from 'webgpu';
import { GraphExecutionEngine } from './graphExecutionEngine.js';

export class GraphExecutor {
  constructor() {
    this.device = null;
    this.adapter = null;
    this.navigator = null;
    this.executionEngine = null;
    this.useGPU = false;
  }
  
  /**
   * Initialize WebGPU (if available)
   */
  async initialize() {
    try {
      console.log('🔧 Initializing graph executor...');
      
      // Setup WebGPU globals (required for node-webgpu)
      Object.assign(globalThis, globals);
      this.navigator = { gpu: create([]) };
      
      // Try to get GPU
      this.adapter = await this.navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
      
      if (this.adapter) {
        this.device = await this.adapter.requestDevice();
        this.useGPU = true;
        console.log('✅ GPU available for graph execution');
        
        // Create execution engine with GPU device
        this.executionEngine = new GraphExecutionEngine(this.device);
      } else {
        console.log('⚠️  No GPU found, using CPU fallback');
      }
      
      // Register node types
      await this.registerNodes();
      
    } catch (error) {
      console.warn('⚠️  GPU initialization failed, using CPU:', error.message);
      this.useGPU = false;
    }
  }
  
  /**
   * Register all node types
   */
  async registerNodes() {
    console.log('📝 Registering node types...');
    
    if (!this.executionEngine) {
      console.log('⚠️  No execution engine, skipping node registration');
      return;
    }
    
    // Import all node implementations
    const { SeedInputNode } = await import('../lib/nodes/SeedInputNode.js');
    const { PerlinNoiseNode } = await import('../lib/nodes/PerlinNoiseNode.js');
    const { NormalizeNode } = await import('../lib/nodes/NormalizeNode.js');
    const { BiomeClassifierNode } = await import('../lib/nodes/BiomeClassifierNode.js');
    const { BlockClassifierNode } = await import('../lib/nodes/BlockClassifierNode.js');
    const { TemperatureNode } = await import('../lib/nodes/TemperatureNode.js');
    const { SlopeMapNode } = await import('../lib/nodes/SlopeMapNode.js');
    const { WaterNode } = await import('../lib/nodes/WaterNode.js');
    
    // Register all nodes
    this.executionEngine.registerNode('SeedInput', SeedInputNode);
    this.executionEngine.registerNode('PerlinNoise', PerlinNoiseNode);
    this.executionEngine.registerNode('Normalize', NormalizeNode);
    this.executionEngine.registerNode('BiomeClassifier', BiomeClassifierNode);
    this.executionEngine.registerNode('BlockClassifier', BlockClassifierNode);
    this.executionEngine.registerNode('Temperature', TemperatureNode);
    this.executionEngine.registerNode('SlopeMap', SlopeMapNode);
    this.executionEngine.registerNode('Water', WaterNode);
    
    console.log(`✅ Registered 8 node types`);
  }
  
  /**
   * Execute node graph for a region
   * @param {object} graph - Node graph definition
   * @param {object} region - Region to generate { x, z, width, height, seed }
   * @param {object} config - World configuration
   * @returns {Promise<object>} Generated data (heightmap, biomemap, etc.)
   */
  async execute(graph, region, config) {
    console.log(`📊 Executing graph for region (${region.x}, ${region.z}), size ${region.width}×${region.height}`);
    const startTime = Date.now();
    
    // If we have GPU and execution engine, use real graph execution
    if (this.useGPU && this.executionEngine && graph.nodes && graph.nodes.length > 0) {
      const results = await this.executeGraphWithEngine(graph, region, config);
      console.log(`✅ Graph executed (GPU) in ${Date.now() - startTime}ms`);
      return results;
    }
    
    // Fallback to placeholder
    const results = await this.generatePlaceholderData(region, config);
    console.log(`✅ Graph executed (CPU fallback) in ${Date.now() - startTime}ms`);
    return results;
  }
  
  /**
   * Execute graph using the execution engine
   */
  async executeGraphWithEngine(graph, region, config) {
    const params = {
      resolution: region.width,
      seed: region.seed || config.seed || Date.now(),
      offsetX: region.x || 0,  // World X offset for this region
      offsetZ: region.z || 0   // World Z offset for this region
    };
    
    console.log(`  🌍 Region params: resolution=${params.resolution}, offset=(${params.offsetX}, ${params.offsetZ})`);
    
    // Execute the entire graph
    await this.executionEngine.execute(graph, params);
    
    // Extract outputs we need (heightmap, biomemap, blockmap)
    const results = this.executionEngine.getAllResults();
    
    // Find output nodes and extract their data
    const output = {};
    
    for (const [nodeId, result] of results.entries()) {
      const node = graph.nodes.find(n => n.id === nodeId);
      if (!node) continue;
      
      // Check for output nodes
      if (node.type === 'DepthOutput' && result.output) {
        output.heightmap = result.output;
      } else if (node.type === 'BiomeOutput' && result.output) {
        output.biomemap = result.output;
      } else if (node.type === 'BlockMapOutput' && result.terrainBlocks) {
        output.blockmap = result.terrainBlocks;
      } else if (node.type === 'WaterOutput' && result.output) {
        output.watermap = result.output;
      }
    }
    
    // If we don't have outputs from Output nodes, extract from intermediate nodes
    if (!output.heightmap || !output.biomemap || !output.blockmap) {
      for (const [nodeId, result] of results.entries()) {
        const node = graph.nodes.find(n => n.id === nodeId);
        if (!node) continue;
        
        // Extract from known node types
        if (node.type === 'Normalize' && result.output && !output.heightmap) {
          output.heightmap = result.output;
        } else if (node.type === 'BiomeClassifier' && result.output && !output.biomemap) {
          output.biomemap = result.output;
        } else if (node.type === 'BlockClassifier' && result.terrainBlocks && !output.blockmap) {
          output.blockmap = result.terrainBlocks;
        }
      }
    }
    
    // Ensure we have all required outputs
    if (!output.heightmap) {
      throw new Error('Graph did not produce heightmap output');
    }
    
    // Provide defaults for missing outputs
    const size = region.width * region.height;
    if (!output.biomemap) {
      output.biomemap = new Uint8Array(size).fill(5); // Default to grassland
    }
    if (!output.blockmap) {
      output.blockmap = new Uint16Array(size).fill(2); // Default to grass
    }
    
    return output;
  }
  
  /**
   * Execute using real GPU nodes
   */
  async executeWithNodes(region, config) {
    const { width, height, seed } = region;
    
    // Use PerlinNoiseNode to generate real terrain
    const PerlinNoiseNode = this.nodeRegistry.get('PerlinNoiseNode');
    if (PerlinNoiseNode) {
      const noiseNode = new PerlinNoiseNode(this.device);
      const result = await noiseNode.process(
        { seed },
        { 
          resolution: width,
          seed,
          frequency: 4.0,
          octaves: 6,
          persistence: 0.5,
          lacunarity: 2.0,
          scale: 10.0
        }
      );
      
      // Use noise output as heightmap
      const heightmap = result.output;
      
      // Generate simple biome map (based on height for now)
      const biomemap = new Uint8Array(width * height);
      for (let i = 0; i < heightmap.length; i++) {
        const h = heightmap[i];
        if (h < 0.3) biomemap[i] = 0; // Deep Ocean
        else if (h < 0.4) biomemap[i] = 1; // Ocean
        else if (h < 0.45) biomemap[i] = 2; // Beach
        else if (h < 0.6) biomemap[i] = 5; // Grassland
        else if (h < 0.75) biomemap[i] = 7; // Forest
        else if (h < 0.85) biomemap[i] = 10; // Mountain
        else biomemap[i] = 11; // Snow Peak
      }
      
      // Generate simple block map (based on biome)
      const blockmap = new Uint16Array(width * height);
      for (let i = 0; i < biomemap.length; i++) {
        const biome = biomemap[i];
        if (biome <= 1) blockmap[i] = 4; // Sand (ocean floor)
        else if (biome === 2) blockmap[i] = 4; // Sand (beach)
        else if (biome === 5) blockmap[i] = 2; // Grass
        else if (biome === 7) blockmap[i] = 2; // Grass (forest)
        else if (biome === 10) blockmap[i] = 3; // Stone (mountain)
        else blockmap[i] = 5; // Snow
      }
      
      return {
        heightmap,
        biomemap,
        blockmap
      };
    }
    
    // No nodes available, use fallback
    return this.generatePlaceholderData(region, config);
  }
  
  /**
   * Generate placeholder data using CPU-based Perlin noise
   * Fallback when GPU execution is not available
   */
  async generatePlaceholderData(region, config) {
    const { width, height, seed } = region;
    const size = width * height;
    
    console.log(`⚠️  Using CPU fallback for terrain generation (GPU not available)`);
    
    // Multi-octave Perlin noise for heightmap
    const heightmap = new Float32Array(size);
    const moistureMap = new Float32Array(size);
    const temperatureMap = new Float32Array(size);
    const biomemap = new Uint8Array(size);
    const blockmap = new Uint16Array(size);
    
    // Generate heightmap with multi-octave Perlin noise (matching graph params)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const worldX = region.x + x;
        const worldZ = region.z + y;
        
        // Base terrain (matches node-1: frequency=3.7, octaves=3, persistence=0.64)
        let terrainHeight = 0;
        let amplitude = 1.0;
        let frequency = 3.7 * 0.4; // frequency * scale
        let maxValue = 0;
        
        for (let octave = 0; octave < 3; octave++) {
          const sampleX = worldX * frequency / width;
          const sampleZ = worldZ * frequency / height;
          terrainHeight += this.perlin2D(sampleX, sampleZ, seed + octave) * amplitude;
          maxValue += amplitude;
          amplitude *= 0.64; // persistence
          frequency *= 2.0; // lacunarity
        }
        
        heightmap[idx] = (terrainHeight / maxValue) * 0.5 + 0.5; // Normalize to 0-1
        
        // Moisture map (matches node-4: frequency=2.9, octaves=2, persistence=0.6)
        let moisture = 0;
        amplitude = 1.0;
        frequency = 2.9 * 0.6;
        maxValue = 0;
        
        for (let octave = 0; octave < 2; octave++) {
          const sampleX = worldX * frequency / width;
          const sampleZ = worldZ * frequency / height;
          moisture += this.perlin2D(sampleX, sampleZ, seed + 1000 + octave) * amplitude;
          maxValue += amplitude;
          amplitude *= 0.6;
          frequency *= 1.7;
        }
        
        moistureMap[idx] = (moisture / maxValue) * 0.5 + 0.5;
        
        // Temperature (simplified, influenced by height and latitude)
        const latitudeFactor = Math.abs(Math.sin(worldZ * 0.001)) * 0.5; // Varies with world Z
        temperatureMap[idx] = (1.0 - latitudeFactor * 0.2) - (heightmap[idx] * 0.51); // elevation influence
        temperatureMap[idx] = Math.max(0, Math.min(1, temperatureMap[idx]));
        
        // Classify biome (simplified version of BiomeClassifier)
        const h = heightmap[idx];
        const m = moistureMap[idx];
        const t = temperatureMap[idx];
        
        if (h < 0.4) {
          biomemap[idx] = h < 0.3 ? 0 : 1; // Deep Ocean / Ocean
          blockmap[idx] = 4; // Sand floor
        } else if (h < 0.45) {
          biomemap[idx] = 2; // Beach
          blockmap[idx] = 4; // Sand
        } else if (h > 0.85) {
          biomemap[idx] = 11; // Snow Peak
          blockmap[idx] = 5; // Snow
        } else if (h > 0.7) {
          biomemap[idx] = t < 0.3 ? 12 : 10; // Alpine / Rocky Mountain
          blockmap[idx] = t < 0.3 ? 5 : 3; // Snow / Stone
        } else {
          // Mid-height terrain - classify by moisture and temperature
          if (t > 0.6 && m < 0.25) {
            biomemap[idx] = 3; // Desert
            blockmap[idx] = 4; // Sand
          } else if (t > 0.7 && m > 0.6) {
            biomemap[idx] = 6; // Tropical Forest
            blockmap[idx] = 1; // Grass
          } else if (t > 0.4 && t < 0.7 && m > 0.3 && m < 0.6) {
            biomemap[idx] = 5; // Grassland
            blockmap[idx] = 1; // Grass
          } else if (t > 0.3 && t < 0.6 && m > 0.5) {
            biomemap[idx] = 7; // Temperate Forest
            blockmap[idx] = 1; // Grass
          } else if (t < 0.4 && m > 0.4) {
            biomemap[idx] = 8; // Taiga
            blockmap[idx] = 1; // Grass
          } else if (t < 0.2) {
            biomemap[idx] = 9; // Tundra
            blockmap[idx] = 5; // Snow
          } else {
            biomemap[idx] = 4; // Savanna
            blockmap[idx] = 1; // Grass
          }
        }
      }
    }
    
    return {
      heightmap,
      biomemap,
      blockmap
    };
  }
  
  /**
   * Improved 2D Perlin noise implementation
   */
  perlin2D(x, y, seed) {
    // Hash function for grid coordinates
    const hash = (ix, iy) => {
      let h = seed + ix * 374761393 + iy * 668265263;
      h = (h ^ (h >> 13)) * 1274126177;
      return (h ^ (h >> 16)) & 0xFFFFFFFF;
    };
    
    // Gradient vectors
    const grad = (hash, x, y) => {
      const h = hash & 7;
      const u = h < 4 ? x : y;
      const v = h < 4 ? y : x;
      return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
    };
    
    // Smoothstep interpolation
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    
    // Grid cell coordinates
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    
    // Local coordinates within cell
    const xf = x - xi;
    const yf = y - yi;
    
    // Fade curves
    const u = fade(xf);
    const v = fade(yf);
    
    // Hash coordinates of 4 corners
    const aa = hash(xi, yi);
    const ab = hash(xi, yi + 1);
    const ba = hash(xi + 1, yi);
    const bb = hash(xi + 1, yi + 1);
    
    // Blend results from 4 corners
    const x1 = grad(aa, xf, yf);
    const x2 = grad(ba, xf - 1, yf);
    const y1 = grad(ab, xf, yf - 1);
    const y2 = grad(bb, xf - 1, yf - 1);
    
    const lerp = (a, b, t) => a + t * (b - a);
    
    return lerp(
      lerp(x1, x2, u),
      lerp(y1, y2, u),
      v
    );
  }
  
  /**
   * Simple seeded random number generator
   */
  seededRandom(seed) {
    let value = seed;
    return () => {
      value = (value * 9301 + 49297) % 233280;
      return value / 233280;
    };
  }
  
  /**
   * Simple noise function (placeholder for Perlin)
   */
  simpleNoise(x, y, seed) {
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
    return n - Math.floor(n);
  }
  
  /**
   * Cleanup
   */
  destroy() {
    if (this.device) {
      this.device.destroy();
    }
  }
}
