/**
 * Minimal SVDAG Builder Example for Testing
 * 
 * This is a simplified SVDAG (Sparse Voxel DAG) builder for quick testing.
 * For production, you'll want a more robust implementation with:
 * - Better hash functions (MurmurHash, xxHash)
 * - Streaming construction for large worlds
 * - GPU-based building (compute shaders)
 * 
 * Usage:
 *   const voxelGrid = new Uint32Array(8*8*8);
 *   voxelGrid[0] = 1; // Set block at (0,0,0) to type 1
 *   const svdag = buildSVDAG(voxelGrid, 8, 3); // size=8, maxDepth=3
 *   // Upload svdag.nodesBuffer and svdag.leavesBuffer to GPU
 */

class SVDAGBuilder {
  constructor(size, maxDepth) {
    this.size = size;
    this.maxDepth = maxDepth;
    this.nodes = [];
    this.leaves = [];
    this.nodeMap = new Map(); // For DAG merging (deduplication)
  }

  /**
   * Build SVDAG from 3D voxel grid
   * @param {Uint32Array} voxelGrid - Flat array of block IDs (size³ elements)
   * @returns {Object} { nodesBuffer, leavesBuffer, rootIdx, stats }
   */
  build(voxelGrid) {
    console.log('Building SVDAG...');
    const startTime = performance.now();
    
    // Build octree from voxels
    const root = this.buildNode(voxelGrid, 0, 0, 0, this.size, 0);
    const rootIdx = this.flattenNode(root);
    
    const buildTime = (performance.now() - startTime).toFixed(2);
    
    const stats = {
      totalNodes: this.nodes.length / 3, // Average 3 u32s per node
      totalLeaves: this.leaves.length,
      buildTimeMs: buildTime,
      compressionRatio: (1 - (this.nodes.length + this.leaves.length) / voxelGrid.length).toFixed(2),
    };
    
    console.log('SVDAG built:', stats);
    
    return {
      nodesBuffer: new Uint32Array(this.nodes),
      leavesBuffer: new Uint32Array(this.leaves),
      rootIdx,
      stats,
    };
  }

  /**
   * Recursively build octree node
   */
  buildNode(voxelGrid, x, y, z, size, depth) {
    // Leaf node - store block ID
    if (depth === this.maxDepth || size === 1) {
      const idx = this.getVoxelIndex(x, y, z);
      const blockId = voxelGrid[idx] || 0;
      return { isLeaf: true, blockId };
    }

    // Inner node - check children
    const halfSize = size / 2;
    const children = [];
    let childMask = 0;

    for (let i = 0; i < 8; i++) {
      const cx = x + (i & 1 ? halfSize : 0);
      const cy = y + (i & 2 ? halfSize : 0);
      const cz = z + (i & 4 ? halfSize : 0);

      const child = this.buildNode(voxelGrid, cx, cy, cz, halfSize, depth + 1);
      
      if (child) {
        children[i] = child;
        childMask |= (1 << i);
      }
    }

    // Empty node - return null to save space
    if (childMask === 0) {
      return null;
    }

    return { isLeaf: false, childMask, children };
  }

  /**
   * Flatten octree to flat GPU buffers with DAG merging
   */
  flattenNode(node) {
    if (!node) {
      return 0; // Null node
    }

    // Hash node for DAG merging (deduplicate identical subtrees)
    const hash = this.hashNode(node);
    if (this.nodeMap.has(hash)) {
      return this.nodeMap.get(hash); // Reuse existing node
    }

    let nodeIdx;

    if (node.isLeaf) {
      // Leaf: [tag=1, leaf_data_idx]
      nodeIdx = this.nodes.length;
      const leafIdx = this.leaves.length;
      
      this.nodes.push(1); // tag=1 for leaf
      this.nodes.push(leafIdx); // index into leaves buffer
      this.leaves.push(node.blockId);
    } else {
      // Inner: [tag=0, child_mask, child_idx_0, ..., child_idx_N]
      nodeIdx = this.nodes.length;
      this.nodes.push(0); // tag=0 for inner
      this.nodes.push(node.childMask);

      // Recursively flatten children
      for (let i = 0; i < 8; i++) {
        if (node.childMask & (1 << i)) {
          const childIdx = this.flattenNode(node.children[i]);
          this.nodes.push(childIdx);
        }
      }
    }

    this.nodeMap.set(hash, nodeIdx);
    return nodeIdx;
  }

  /**
   * Hash node for DAG merging (simple but effective)
   */
  hashNode(node) {
    if (node.isLeaf) {
      return `L${node.blockId}`;
    }
    
    // Hash based on child structure
    let hash = `N${node.childMask}`;
    for (let i = 0; i < 8; i++) {
      if (node.childMask & (1 << i)) {
        hash += `_${this.hashNode(node.children[i])}`;
      }
    }
    return hash;
  }

  /**
   * Get 1D index from 3D coordinate
   */
  getVoxelIndex(x, y, z) {
    return z * this.size * this.size + y * this.size + x;
  }
}

/**
 * Helper: Create test voxel grids
 */
const TestScenes = {
  /**
   * Single voxel at origin
   */
  singleVoxel(size = 8) {
    const grid = new Uint32Array(size * size * size);
    grid[0] = 1; // Block type 1 at (0,0,0)
    return grid;
  },

  /**
   * Flat floor (y=0 plane)
   */
  floor(size = 8, blockId = 1) {
    const grid = new Uint32Array(size * size * size);
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        grid[z * size * size + 0 * size + x] = blockId;
      }
    }
    return grid;
  },

  /**
   * Hollow cube (only edges/faces)
   */
  hollowCube(size = 8, blockId = 2) {
    const grid = new Uint32Array(size * size * size);
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        for (let z = 0; z < size; z++) {
          // Only set boundary voxels
          if (x === 0 || x === size - 1 ||
              y === 0 || y === size - 1 ||
              z === 0 || z === size - 1) {
            grid[z * size * size + y * size + x] = blockId;
          }
        }
      }
    }
    return grid;
  },

  /**
   * Random sparse voxels (30% filled)
   */
  random(size = 8, fillRatio = 0.3) {
    const grid = new Uint32Array(size * size * size);
    for (let i = 0; i < grid.length; i++) {
      if (Math.random() < fillRatio) {
        grid[i] = Math.floor(Math.random() * 5) + 1; // Block types 1-5
      }
    }
    return grid;
  },

  /**
   * Sphere (filled)
   */
  sphere(size = 16, radius = 6, blockId = 3) {
    const grid = new Uint32Array(size * size * size);
    const center = size / 2;
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        for (let z = 0; z < size; z++) {
          const dx = x - center;
          const dy = y - center;
          const dz = z - center;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist <= radius) {
            grid[z * size * size + y * size + x] = blockId;
          }
        }
      }
    }
    return grid;
  },
};

/**
 * Example Usage
 */
function exampleUsage() {
  // Test 1: Single voxel (simplest case)
  console.log('\n=== Test 1: Single Voxel ===');
  const scene1 = TestScenes.singleVoxel(8);
  const builder1 = new SVDAGBuilder(8, 3);
  const svdag1 = builder1.build(scene1);
  console.log('Nodes buffer size:', svdag1.nodesBuffer.length, 'u32s');
  console.log('Leaves buffer size:', svdag1.leavesBuffer.length, 'u32s');
  console.log('Root index:', svdag1.rootIdx);

  // Test 2: Floor (check DAG merging - all floor voxels are identical)
  console.log('\n=== Test 2: Floor (8x8) ===');
  const scene2 = TestScenes.floor(8, 1);
  const builder2 = new SVDAGBuilder(8, 3);
  const svdag2 = builder2.build(scene2);
  console.log('Compression ratio:', svdag2.stats.compressionRatio);
  console.log('(Should be high due to DAG merging of identical floor tiles)');

  // Test 3: Hollow cube (sparse - SVDAG should skip empty center)
  console.log('\n=== Test 3: Hollow Cube ===');
  const scene3 = TestScenes.hollowCube(8, 2);
  const builder3 = new SVDAGBuilder(8, 3);
  const svdag3 = builder3.build(scene3);
  console.log('Total nodes:', svdag3.stats.totalNodes);
  console.log('(Should be less than full cube due to empty interior)');

  // Test 4: Random sparse (realistic case)
  console.log('\n=== Test 4: Random Sparse (30% filled) ===');
  const scene4 = TestScenes.random(16, 0.3);
  const builder4 = new SVDAGBuilder(16, 4); // depth=4 for 16^3
  const svdag4 = builder4.build(scene4);
  console.log('Build time:', svdag4.stats.buildTimeMs, 'ms');
  console.log('Compression vs full grid:', svdag4.stats.compressionRatio);

  // Return for GPU upload
  return svdag4;
}

/**
 * Integration with WebGPU (example)
 */
function uploadToGPU(device, svdag) {
  // Create GPU buffers
  const nodesBuffer = device.createBuffer({
    label: 'SVDAG Nodes',
    size: svdag.nodesBuffer.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint32Array(nodesBuffer.getMappedRange()).set(svdag.nodesBuffer);
  nodesBuffer.unmap();

  const leavesBuffer = device.createBuffer({
    label: 'SVDAG Leaves',
    size: svdag.leavesBuffer.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint32Array(leavesBuffer.getMappedRange()).set(svdag.leavesBuffer);
  leavesBuffer.unmap();

  // Create SVDAGParams uniform
  const maxDepth = Math.log2(16); // Assuming 16^3 world
  const svdagParamsData = new Float32Array([
    svdag.rootIdx,                  // root_index (u32)
    maxDepth,                       // max_depth (u32)
    0.333333,                       // leaf_size (f32)
    svdag.nodesBuffer.length,       // node_count (u32)
    16 * 0.333333,                  // world_size (f32)
    0, 0, 0                         // padding
  ]);

  const svdagParamsBuffer = device.createBuffer({
    label: 'SVDAG Params',
    size: svdagParamsData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Float32Array(svdagParamsBuffer.getMappedRange()).set(svdagParamsData);
  svdagParamsBuffer.unmap();

  return { nodesBuffer, leavesBuffer, svdagParamsBuffer };
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SVDAGBuilder, TestScenes, uploadToGPU };
}

// Run example if executed directly
if (typeof window !== 'undefined') {
  console.log('SVDAG Builder loaded. Run exampleUsage() to see examples.');
}
