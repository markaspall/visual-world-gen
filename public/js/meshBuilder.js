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
    this.voxelSize = 0.333; // Default, will be overridden
  }

  /**
   * Build an optimized mesh from world data
   * 
   * @param {Object} worldData - World data from generator
   * @param {Float32Array} heightMap - Height values (in voxel coordinates 0-512)
   * @param {Uint8Array} blocksMap - Block type IDs (512×512)
   * @param {Float32Array} waterMap - Water elevation (normalized 0-1, multiply by 256 for voxel height)
   * @param {number} resolution - World resolution (512)
   * @returns {Object} Mesh data ready for GPU
   */
  buildTerrainMesh(worldData, heightMap, blocksMap, waterMap, resolution) {
    console.log('🔨 Building greedy mesh (terrain + water)...');
    const startTime = performance.now();
    
    // Use voxelSize from world data
    this.voxelSize = worldData.voxelSize || 0.333;
    console.log(`  → Voxel size: ${this.voxelSize}m`);

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
    
    // Log available materials for debugging
    console.log('📦 Available materials:');
    worldData.blocks.forEach(block => {
      console.log(`  - ${block.name} (ID: ${block.id}, Color: ${block.color})`);
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
        return 0;
      }
      return blocksMap[z * resolution + x];
    };
    
    // Helper to get water elevation at (x, z)
    const getWaterLevel = (x, z) => {
      if (x < 0 || x >= resolution || z < 0 || z >= resolution) {
        return 0;
      }
      // Water map is normalized 0-1, convert to same scale as terrain (0-512)
      return waterMap[z * resolution + x] * 512.0;
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

    // Note: Water is now generated from waterMap, not from block materials

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
    
    // Debug: Check height range
    let minHeight = Infinity;
    let maxHeight = -Infinity;
    for (let i = 0; i < heightMap.length; i++) {
      minHeight = Math.min(minHeight, heightMap[i]);
      maxHeight = Math.max(maxHeight, heightMap[i]);
    }
    console.log(`  → Height range: ${minHeight.toFixed(2)} - ${maxHeight.toFixed(2)} voxels`);
    console.log(`  → World coords: ${(minHeight * this.voxelSize).toFixed(2)}m - ${(maxHeight * this.voxelSize).toFixed(2)}m`);
    
    // Phase 1: Generate all top faces (one quad per voxel column)
    for (let z = 0; z < resolution; z++) {
      for (let x = 0; x < resolution; x++) {
        const height = getHeight(x, z);
        const blockId = getBlock(x, z);
        
        // Skip air blocks
        if (blockId === 0) continue;
        
        // Position in world coordinates
        // Apply voxelSize to ALL dimensions for cubic voxels
        const y = height * this.voxelSize;
        const x0 = x * this.voxelSize;
        const z0 = z * this.voxelSize;
        const x1 = (x + 1) * this.voxelSize;
        const z1 = (z + 1) * this.voxelSize;
        
        // Use flat normal for crisp voxel look (pointing up)
        const normal = [0, 1, 0];
        
        // Get color from material
        const color = getBlockColor(blockId);
        
        // Terrain blocks are NOT water (water comes from waterMap)
        const materialId = blockId;
        
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
        materialIds.push(materialId);
        
        // v1: (x1, y, z0)
        vertices.push(x1, y, z0);
        normals.push(...normal);
        colors.push(...color);
        materialIds.push(materialId);
        
        // v2: (x1, y, z1)
        vertices.push(x1, y, z1);
        normals.push(...normal);
        colors.push(...color);
        materialIds.push(materialId);
        
        // v3: (x0, y, z1)
        vertices.push(x0, y, z1);
        normals.push(...normal);
        colors.push(...color);
        materialIds.push(materialId);
        
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
        
        // Position in world coordinates (same as top faces)
        const y = height * this.voxelSize;
        const x0 = x * this.voxelSize;
        const z0 = z * this.voxelSize;
        const x1 = (x + 1) * this.voxelSize;
        const z1 = (z + 1) * this.voxelSize;
        
        const color = getBlockColor(blockId);
        const materialId = blockId; // Terrain only, water is separate
        
        // Use flat normals for all terrain side faces too
        const normalUp = [0, 1, 0];
        
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
          materialIds.push(materialId);
          
          vertices.push(x1, y, z0);   // Top-left
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(materialId);
          
          vertices.push(x1, y, z1);   // Top-right
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(materialId);
          
          vertices.push(x1, y1, z1);  // Bottom-right
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(materialId);
          
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
          materialIds.push(materialId);
          
          vertices.push(x0, y, z1);   // Top-left
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(materialId);
          
          vertices.push(x0, y, z0);   // Top-right
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(materialId);
          
          vertices.push(x0, y1, z0);  // Bottom-right
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(materialId);
          
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
          materialIds.push(materialId);
          
          vertices.push(x0, y, z1);   // Top-left
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(materialId);
          
          vertices.push(x1, y, z1);   // Top-right
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(materialId);
          
          vertices.push(x1, y1, z1);  // Bottom-right
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(materialId);
          
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
          materialIds.push(materialId);
          
          vertices.push(x1, y, z0);   // Top-left
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(materialId);
          
          vertices.push(x0, y, z0);   // Top-right
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(materialId);
          
          vertices.push(x0, y1, z0);  // Bottom-right
          normals.push(...normal);
          colors.push(...color);
          materialIds.push(materialId);
          
          indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
          indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
        }
      }
    }
    
    console.log('  → Generating water voxels (3D blocks)...');
    
    // Phase 3: Generate water as 3D voxel blocks (like Minecraft water)
    let waterVoxelCount = 0;
    let waterFaceCount = 0;
    let minWater = Infinity;
    let maxWater = -Infinity;
    
    // Find Water block material from world data
    const waterBlock = worldData.blocks.find(b => b.name.toLowerCase() === 'water');
    const waterColor = waterBlock ? getBlockColor(waterBlock.id) : [0.12, 0.56, 1.0];
    const waterMaterialId = waterBlock ? (waterBlock.id | 0x80000000) : 0x80000000;
    
    console.log(`  → Water color from material ID ${waterBlock?.id}: [${waterColor.join(', ')}]`);
    
    // Helper to check if a position should have water
    const hasWater = (x, z, y) => {
      if (x < 0 || x >= resolution || z < 0 || z >= resolution) return false;
      const waterLevel = getWaterLevel(x, z);
      const terrainHeight = getHeight(x, z);
      return y <= waterLevel && y > terrainHeight;
    };
    
    for (let z = 0; z < resolution; z++) {
      for (let x = 0; x < resolution; x++) {
        const waterLevel = getWaterLevel(x, z); // In voxels (0-512)
        const terrainHeight = getHeight(x, z); // In voxels (0-512)
        
        // Skip if no water here (water must be above terrain)
        if (waterLevel <= terrainHeight) continue;
        
        minWater = Math.min(minWater, waterLevel);
        maxWater = Math.max(maxWater, waterLevel);
        
        // Generate vertical column of water voxels from terrain to water level
        const startY = Math.floor(terrainHeight) + 1; // First voxel above terrain
        const endY = Math.ceil(waterLevel); // Last voxel at water level
        
        for (let y = startY; y <= endY; y++) {
          waterVoxelCount++;
          
          // World coordinates for this water voxel (cubic!)
          const wy = y * this.voxelSize;
          const x0 = x * this.voxelSize;
          const z0 = z * this.voxelSize;
          const x1 = (x + 1) * this.voxelSize;
          const z1 = (z + 1) * this.voxelSize;
          const y0 = wy;
          const y1 = wy + this.voxelSize;
          
          // Only render exposed faces (not faces touching other water voxels)
          
          // Top face (+Y) - only if no water above OR this is the top water voxel
          if (!hasWater(x, z, y + 1)) {
            const normal = [0, 1, 0];
            const baseIndex = vertices.length / 3;
            
            vertices.push(x0, y1, z0);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            vertices.push(x1, y1, z0);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            vertices.push(x1, y1, z1);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            vertices.push(x0, y1, z1);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
            indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
            waterFaceCount++;
          }
          
          // Bottom face (-Y) - only if no water below
          if (!hasWater(x, z, y - 1)) {
            const normal = [0, -1, 0];
            const baseIndex = vertices.length / 3;
            
            vertices.push(x0, y0, z0);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            vertices.push(x0, y0, z1);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            vertices.push(x1, y0, z1);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            vertices.push(x1, y0, z0);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
            indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
            waterFaceCount++;
          }
          
          // +X face (right)
          if (!hasWater(x + 1, z, y)) {
            const normal = [1, 0, 0];
            const baseIndex = vertices.length / 3;
            
            vertices.push(x1, y0, z0);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            vertices.push(x1, y1, z0);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            vertices.push(x1, y1, z1);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            vertices.push(x1, y0, z1);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
            indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
            waterFaceCount++;
          }
          
          // -X face (left)
          if (!hasWater(x - 1, z, y)) {
            const normal = [-1, 0, 0];
            const baseIndex = vertices.length / 3;
            
            vertices.push(x0, y0, z0);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            vertices.push(x0, y0, z1);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            vertices.push(x0, y1, z1);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            vertices.push(x0, y1, z0);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
            indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
            waterFaceCount++;
          }
          
          // +Z face (back)
          if (!hasWater(x, z + 1, y)) {
            const normal = [0, 0, 1];
            const baseIndex = vertices.length / 3;
            
            vertices.push(x0, y0, z1);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            vertices.push(x1, y0, z1);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            vertices.push(x1, y1, z1);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            vertices.push(x0, y1, z1);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
            indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
            waterFaceCount++;
          }
          
          // -Z face (front)
          if (!hasWater(x, z - 1, y)) {
            const normal = [0, 0, -1];
            const baseIndex = vertices.length / 3;
            
            vertices.push(x0, y0, z0);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            vertices.push(x0, y1, z0);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            vertices.push(x1, y1, z0);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            vertices.push(x1, y0, z0);
            normals.push(...normal);
            colors.push(...waterColor);
            materialIds.push(waterMaterialId);
            
            indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
            indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
            waterFaceCount++;
          }
        }
      }
    }
    
    if (waterVoxelCount > 0) {
      console.log(`  → Generated ${waterVoxelCount} water voxels (${waterFaceCount} faces)`);
      console.log(`  → Water height range: ${minWater.toFixed(2)} - ${maxWater.toFixed(2)} voxels`);
      console.log(`  → Water world coords: ${(minWater * this.voxelSize).toFixed(2)}m - ${(maxWater * this.voxelSize).toFixed(2)}m`);
    } else {
      console.log(`  → No water generated (all water below terrain)`);
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
