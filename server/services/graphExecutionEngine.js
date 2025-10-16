/**
 * Graph Execution Engine - Server-side
 * Manages execution of node graphs with topological sorting
 */

export class GraphExecutionEngine {
  constructor(device) {
    this.device = device;
    this.nodeRegistry = new Map();
    this.nodeResults = new Map();
  }

  /**
   * Register a node type
   */
  registerNode(type, NodeClass) {
    this.nodeRegistry.set(type, NodeClass);
  }

  /**
   * Execute entire graph
   * @param {object} graph - Graph definition with nodes and connections
   * @param {object} params - Execution parameters (resolution, seed, etc.)
   * @returns {Promise<Map>} - Results from all nodes
   */
  async execute(graph, params) {
    console.log(`🔄 Executing graph with ${graph.nodes.length} nodes, ${graph.connections.length} connections`);
    const startTime = Date.now();
    
    // Clear previous results
    this.nodeResults.clear();
    
    // Build execution order (topological sort)
    const order = this.topologicalSort(graph);
    console.log(`📋 Execution order: ${order.join(' → ')}`);
    
    // Execute nodes in order
    for (const nodeId of order) {
      const nodeData = graph.nodes.find(n => n.id === nodeId);
      if (!nodeData) continue;
      
      await this.executeNode(nodeId, nodeData, graph, params);
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`✅ Graph execution complete in ${totalTime}ms`);
    
    return this.nodeResults;
  }

  /**
   * Execute a single node
   */
  async executeNode(nodeId, nodeData, graph, params) {
    console.log(`  🔧 ${nodeData.type} (${nodeId})`);
    
    // Get node class
    const NodeClass = this.nodeRegistry.get(nodeData.type);
    if (!NodeClass) {
      console.warn(`⚠️  Unknown node type: ${nodeData.type}, skipping`);
      return;
    }
    
    // Create node instance
    const node = new NodeClass(this.device);
    
    // Gather inputs from connected nodes
    const inputs = {};
    const inputConnections = graph.connections.filter(c => c.to === nodeId);
    
    for (const conn of inputConnections) {
      const sourceResult = this.nodeResults.get(conn.from);
      if (sourceResult && sourceResult[conn.output]) {
        inputs[conn.input] = sourceResult[conn.output];
      }
    }
    
    // Merge node params with execution params
    const nodeParams = {
      ...nodeData.params,
      resolution: params.resolution || 512,
      seed: params.seed || Date.now()
    };
    
    // Execute node
    try {
      const nodeStartTime = Date.now();
      const result = await node.process(inputs, nodeParams);
      const nodeTime = Date.now() - nodeStartTime;
      
      this.nodeResults.set(nodeId, result);
      console.log(`    ✓ Completed in ${nodeTime}ms`);
    } catch (error) {
      console.error(`    ✗ Error executing ${nodeData.type}:`, error.message);
      throw error;
    }
  }

  /**
   * Topological sort for execution order
   * Returns array of node IDs in dependency order
   */
  topologicalSort(graph) {
    const order = [];
    const visited = new Set();
    const temp = new Set();
    
    const visit = (nodeId) => {
      if (temp.has(nodeId)) {
        throw new Error(`❌ Cycle detected in graph at node: ${nodeId}`);
      }
      if (visited.has(nodeId)) return;
      
      temp.add(nodeId);
      
      // Visit all nodes that depend on this one
      const outgoing = graph.connections.filter(c => c.from === nodeId);
      for (const conn of outgoing) {
        visit(conn.to);
      }
      
      temp.delete(nodeId);
      visited.add(nodeId);
      order.unshift(nodeId); // Add to front (reverse post-order)
    };
    
    // Visit all nodes
    for (const node of graph.nodes) {
      if (!visited.has(node.id)) {
        visit(node.id);
      }
    }
    
    return order;
  }

  /**
   * Get all dependencies for a node
   */
  getNodeDependencies(nodeId, graph) {
    const dependencies = [];
    const visited = new Set();
    
    const visit = (id) => {
      if (visited.has(id)) return;
      visited.add(id);
      
      const connections = graph.connections.filter(c => c.to === id);
      for (const conn of connections) {
        visit(conn.from);
        dependencies.push(conn.from);
      }
    };
    
    visit(nodeId);
    return dependencies;
  }

  /**
   * Get results from a specific node
   */
  getNodeResult(nodeId) {
    return this.nodeResults.get(nodeId);
  }

  /**
   * Get all results
   */
  getAllResults() {
    return this.nodeResults;
  }

  /**
   * Get output from Output nodes
   */
  getOutputs() {
    const outputs = {};
    
    for (const [nodeId, result] of this.nodeResults.entries()) {
      const node = this.nodeRegistry.get(nodeId);
      // Check if node type ends with 'Output'
      if (node && node.name && node.name.endsWith('Output')) {
        const mapType = node.name.replace('Output', '').toLowerCase();
        outputs[mapType] = result.output || result;
      }
    }
    
    return outputs;
  }
}
