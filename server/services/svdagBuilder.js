/**
 * SVDAG Builder - Server-side version
 * Ported from client-side svdagRenderer.js
 * Builds Sparse Voxel Directed Acyclic Graph from voxel grids
 */

export class SVDAGBuilder {
  /**
   * Build SVDAG from voxel grid
   * @param {Uint32Array} voxelGrid - 3D voxel grid (flattened)
   * @param {number} size - Grid size (must be power of 2)
   * @param {object} options - Build options
   * @returns {object} SVDAG data
   */
  build(voxelGrid, size, options = {}) {
    this.size = size;
    this.maxDepth = Math.log2(size);
    this.nodes = [];
    this.leaves = [];
    this.nodeMap = new Map();
    this.materials = options.materials || null;
    this.buildOpaqueDag = options.buildOpaque || false;
    
    // DEBUG: Count non-air voxels FIRST
    let solidCount = 0;
    const blockCounts = {};
    for (let i = 0; i < voxelGrid.length; i++) {
      if (voxelGrid[i] !== 0) {
        solidCount++;
        blockCounts[voxelGrid[i]] = (blockCounts[voxelGrid[i]] || 0) + 1;
      }
    }
    
    const startTime = Date.now();
    
    // Phase 1: Build octree
    this._leafCount = 0;  // Reset counter
    const root = this.buildNode(voxelGrid, 0, 0, 0, this.size, 0);
    
    
    // Phase 2: Flatten to DAG (deduplicate nodes)
    this.flattenProgress = 0;
    this._dedupCount = 0;
    const rootIdx = this.flattenNode(root);
    
    
    const buildTime = Date.now() - startTime;
    
    const stats = {
      totalNodes: Math.floor(this.nodes.length / 3),
      totalLeaves: this.leaves.length,
      buildTimeMs: buildTime,
      compressionRatio: (1 - (this.nodes.length + this.leaves.length) / voxelGrid.length).toFixed(3),
      dedupSavings: this.nodeMap.size
    };
    
    
    return {
      nodesBuffer: new Uint32Array(this.nodes),
      leavesBuffer: new Uint32Array(this.leaves),
      rootIdx,
      nodeCount: this.nodes.length,
      leafCount: this.leaves.length,
      stats
    };
  }
  
  /**
   * Build octree node recursively
   */
  buildNode(voxelGrid, x, y, z, size, depth) {
    if (depth === this.maxDepth || size === 1) {
      // Leaf node
      const idx = this.getVoxelIndex(x, y, z);
      const blockId = voxelGrid[idx] || 0;
      
      // Count leaves
      if (!this._leafCount) this._leafCount = 0;
      if (blockId !== 0) this._leafCount++;
      
      // Air nodes are pruned
      if (blockId === 0) {
        return null;
      }
      
      // For opaque DAG: treat transparent materials as empty
      if (this.buildOpaqueDag && this.materials && blockId < this.materials.length) {
        const material = this.materials[blockId];
        if (material && material.transparent > 0.0) {
          return null;
        }
      }
      
      return { isLeaf: true, blockId };
    }
    
    // Inner node - subdivide into 8 octants
    const halfSize = Math.floor(size / 2);
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
    
    // If no children, this node is empty
    if (childMask === 0) {
      return null;
    }
    
    return { isLeaf: false, childMask, children };
  }
  
  /**
   * Flatten octree to linear array with deduplication
   */
  flattenNode(node) {
    if (!node) {
      return 0; // Null nodes = air
    }
    
    let nodeIdx;
    
    if (node.isLeaf) {
      // Leaf: [tag=1, leaf_data_idx]
      // LEAVES ARE DEDUPLICATED by blockId in DAG!
      const hash = `L${node.blockId}`;
      if (this.nodeMap.has(hash)) {
        if (!this._dedupCount) this._dedupCount = 0;
        this._dedupCount++;
        return this.nodeMap.get(hash); // Reuse leaf with same blockId
      }
      
      nodeIdx = this.nodes.length;
      const leafIdx = this.leaves.length;
      
      this.nodes.push(1); // tag=1 for leaf
      this.nodes.push(leafIdx); // index into leaves buffer
      this.nodes.push(0); // padding for alignment
      this.leaves.push(node.blockId);
      
      // Cache leaf by blockId
      this.nodeMap.set(hash, nodeIdx);
    } else {
      // Inner node: Try DAG merging
      const hash = this.hashNode(node);
      if (this.nodeMap.has(hash)) {
        if (!this._dedupCount) this._dedupCount = 0;
        this._dedupCount++;
        return this.nodeMap.get(hash); // Reuse existing node
      }
      
      // Reserve space for this node
      nodeIdx = this.nodes.length;
      this.nodes.push(0); // tag=0 for inner
      this.nodes.push(node.childMask);
      
      // Reserve space for child indices
      const childIndicesStart = this.nodes.length;
      let childCount = 0;
      for (let i = 0; i < 8; i++) {
        if (node.childMask & (1 << i)) {
          this.nodes.push(0); // Placeholder
          childCount++;
        }
      }
      
      // Recursively flatten children
      let childSlot = 0;
      for (let i = 0; i < 8; i++) {
        if (node.childMask & (1 << i)) {
          const childIdx = this.flattenNode(node.children[i]);
          this.nodes[childIndicesStart + childSlot] = childIdx;
          childSlot++;
        }
      }
      
      // Cache for DAG merging
      this.nodeMap.set(hash, nodeIdx);
    }
    
    return nodeIdx;
  }
  
  /**
   * Hash node for deduplication
   */
  hashNode(node) {
    if (node._hash !== undefined) {
      return node._hash;
    }
    
    if (node.isLeaf) {
      node._hash = `L${node.blockId}`;
      return node._hash;
    }
    
    // Hash inner nodes by child structure
    const parts = [node.childMask];
    for (let i = 0; i < 8; i++) {
      if (node.childMask & (1 << i)) {
        parts.push(this.hashNode(node.children[i]));
      }
    }
    node._hash = parts.join('|');
    return node._hash;
  }
  
  /**
   * Get voxel index from 3D coordinates
   */
  getVoxelIndex(x, y, z) {
    return z * this.size * this.size + y * this.size + x;
  }
}
