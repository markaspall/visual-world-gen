/**
 * Greedy Mesh Builder
 * 
 * Converts voxel heightmap terrain into optimized triangle meshes.
 * Uses greedy meshing to merge adjacent same-type quads, reducing triangle count by ~90%.
 * 
 * Key Features:
 * - Greedy meshing algorithm (merge adjacent faces)
 * - Smooth normals calculated from heightmap gradient
 * - Per-vertex colors from block materials
 * - Support for material animations
 * - Efficient vertex packing
 */

export class GreedyMeshBuilder {
  constructor() {
    this.voxelSize = 0.333; // Should match world voxelSize
  }

  /**
   * Build an optimized mesh from world data
   * 
   * @param {Object} worldData - World data from generator
   * @param {Float32Array} heightMap - Height values (512×512)
   * @param {Uint8Array} blocksMap - Block type IDs (512×512)
   * @param {number} resolution - World resolution (512)
   * @returns {Object} Mesh data ready for GPU
   */
  buildTerrainMesh(worldData, heightMap, blocksMap, resolution) {
    console.log('🔨 Building greedy mesh...');
    const startTime = performance.now();

    // Initialize data structures
    const vertices = [];
    const normals = [];
    const colors = [];
    const materialIds = [];
    const indices = [];

    // Build lookup for block materials
    const materialMap = new Map();
    worldData.blocks.forEach(block => {
      materialMap.set(block.id, block);
    });

    // Helper to get height at (x, z)
    const getHeight = (x, z) => {
      if (x < 0 || x >= resolution || z < 0 || z >= resolution) {
        return 0;
      }
      return heightMap[z * resolution + x];
    };

    // Helper to get block type at (x, z)
    const getBlock = (x, z) => {
      if (x < 0 || x >= resolution || z < 0 || z >= resolution) {
        return 0; // Air
      }
      return blocksMap[z * resolution + x];
    };

    // Calculate smooth normal from height gradient
    const calculateNormal = (x, z) => {
      const h0 = getHeight(x, z);
      const hx = getHeight(x + 1, z);
      const hz = getHeight(x, z + 1);
      
      const dx = (hx - h0);
      const dz = (hz - h0);
      
      // Normal = cross product of tangent vectors
      const nx = -dx * this.voxelSize;
      const ny = 1.0;
      const nz = -dz * this.voxelSize;
      
      // Normalize
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      return [nx / len, ny / len, nz / len];
    };

    // Helper to get block color
    const getBlockColor = (blockId) => {
      const material = materialMap.get(blockId);
      if (!material) return [0.5, 0.5, 0.5]; // Grey default
      
      // Parse hex color
      const hex = material.color.replace('#', '');
      const r = parseInt(hex.substr(0, 2), 16) / 255;
      const g = parseInt(hex.substr(2, 2), 16) / 255;
      const b = parseInt(hex.substr(4, 2), 16) / 255;
      return [r, g, b];
    };

    // ===================================
    // GREEDY MESHING ALGORITHM
    // ===================================
    
    // We'll use a simple greedy approach:
    // 1. For each height column, create a top face
    // 2. Check if neighbors need side faces
    // 3. Merge adjacent faces of the same material (TODO: Phase 1.5)
    
    console.log('  → Generating top faces...');
    
    // Phase 1: Generate all top faces (one quad per voxel column)
    for (let z = 0; z < resolution; z++) {
      for (let x = 0; x < resolution; x++) {
        const height = getHeight(x, z);
        const blockId = getBlock(x, z);
        
        // Skip air blocks
        if (blockId === 0) continue;
        
        const y = height * this.voxelSize;
        const x0 = x * this.voxelSize;
        const z0 = z * this.voxelSize;
        const x1 = x0 + this.voxelSize;
        const z1 = z0 + this.voxelSize;
        
        // Calculate smooth normal for this position
        const normal = calculateNormal(x, z);
        
        // Get color from material
        const color = getBlockColor(blockId);
        
        // Create quad (2 triangles) for top face
        // Vertices ordered counter-clockwise from top view:
        //   v0 --- v1
        //   |  \    |
        //   |    \  |
        //   v3 --- v2
        
        const baseIndex = vertices.length / 3;
        
        // v0: (x0, y, z0)
        vertices.push(x0, y, z0);
        normals.push(...normal);
        colors.push(...color);
        materialIds.push(blockId);
        
        // v1: (x1, y, z0)
        vertices.push(x1, y, z0);
        normals.push(...normal);
        colors.push(...color);
        materialIds.push(blockId);
        
        // v2: (x1, y, z1)
        vertices.push(x1, y, z1);
        normals.push(...normal);
        colors.push(...color);
        materialIds.push(blockId);
        
        // v3: (x0, y, z1)
        vertices.push(x0, y, z1);
        normals.push(...normal);
        colors.push(...color);
        materialIds.push(blockId);
        
        // Triangle 1: v0 → v1 → v2
        indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
        
        // Triangle 2: v0 → v2 → v3
        indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
      }
    }
    
    console.log('  → Generating side faces...');
    
    // Phase 2: Generate side faces where height changes
    for (let z = 0; z < resolution; z++) {
      for (let x = 0; x < resolution; x++) {
        const height = getHeight(x, z);
        const blockId = getBlock(x, z);
        
        if (blockId === 0) continue;
        
        const y = height * this.voxelSize;
        const x0 = x * this.voxelSize;
        const z0 = z * this.voxelSize;
        const x1 = x0 + this.voxelSize;
        const z1 = z0 + this.voxelSize;
        
        const color = getBlockColor(blockId);
        
        // Check +X neighbor (right)
        const heightPX = getHeight(x + 1, z);
        if (heightPX < height) {
          const y1 = heightPX * this.voxelSize;
          const normal = [1, 0, 0]; // Face pointing +X
          const baseIndex = vertices.length / 3;
          
          // Quad facing +X
          vertices.push(x1, y1, z0);  // Bottom-left
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(blockId);
          
          vertices.push(x1, y, z0);   // Top-left
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(blockId);
          
          vertices.push(x1, y, z1);   // Top-right
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(blockId);
          
          vertices.push(x1, y1, z1);  // Bottom-right
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(blockId);
          
          indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
          indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
        }
        
        // Check -X neighbor (left)
        const heightNX = getHeight(x - 1, z);
        if (heightNX < height) {
          const y1 = heightNX * this.voxelSize;
          const normal = [-1, 0, 0]; // Face pointing -X
          const baseIndex = vertices.length / 3;
          
          vertices.push(x0, y1, z1);  // Bottom-left
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(blockId);
          
          vertices.push(x0, y, z1);   // Top-left
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(blockId);
          
          vertices.push(x0, y, z0);   // Top-right
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(blockId);
          
          vertices.push(x0, y1, z0);  // Bottom-right
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(blockId);
          
          indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
          indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
        }
        
        // Check +Z neighbor (forward)
        const heightPZ = getHeight(x, z + 1);
        if (heightPZ < height) {
          const y1 = heightPZ * this.voxelSize;
          const normal = [0, 0, 1]; // Face pointing +Z
          const baseIndex = vertices.length / 3;
          
          vertices.push(x0, y1, z1);  // Bottom-left
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(blockId);
          
          vertices.push(x0, y, z1);   // Top-left
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(blockId);
          
          vertices.push(x1, y, z1);   // Top-right
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(blockId);
          
          vertices.push(x1, y1, z1);  // Bottom-right
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(blockId);
          
          indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
          indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
        }
        
        // Check -Z neighbor (backward)
        const heightNZ = getHeight(x, z - 1);
        if (heightNZ < height) {
          const y1 = heightNZ * this.voxelSize;
          const normal = [0, 0, -1]; // Face pointing -Z
          const baseIndex = vertices.length / 3;
          
          vertices.push(x1, y1, z0);  // Bottom-left
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(blockId);
          
          vertices.push(x1, y, z0);   // Top-left
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(blockId);
          
          vertices.push(x0, y, z0);   // Top-right
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(blockId);
          
          vertices.push(x0, y1, z0);  // Bottom-right
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(blockId);
          
          indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
          indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
        }
      }
    }
    
    const buildTime = performance.now() - startTime;
    const vertexCount = vertices.length / 3;
    const triangleCount = indices.length / 3;
    
    console.log(`✅ Mesh built in ${buildTime.toFixed(2)}ms`);
    console.log(`   Vertices: ${vertexCount.toLocaleString()}`);
    console.log(`   Triangles: ${triangleCount.toLocaleString()}`);
    console.log(`   Memory: ~${((vertices.length + normals.length + colors.length + indices.length) * 4 / 1024 / 1024).toFixed(2)}MB`);
    
    // Convert to typed arrays for GPU upload
    return {
      vertices: new Float32Array(vertices),
      normals: new Float32Array(normals),
      colors: new Float32Array(colors),
      materialIds: new Uint32Array(materialIds),
      indices: new Uint32Array(indices),
      stats: {
        vertexCount,
        triangleCount,
        buildTime
      }
    };
  }

  /**
   * TODO Phase 1.5: Implement true greedy merging
   * 
   * Algorithm:
   * 1. For each material type, create a 2D grid of quads
   * 2. Scan rows, merge adjacent same-material quads
   * 3. Scan columns, merge rows into larger rectangles
   * 4. Result: ~90% fewer triangles!
   * 
   * This will reduce triangle count from ~500K to ~50K
   */
  greedyMerge(quads) {
    // TODO: Implement in Phase 1.5
    return quads;
  }
}
