import { PerlinNoiseNode } from './nodes/PerlinNoiseNode.js';
import { SeedInputNode } from './nodes/SeedInputNode.js';
import { BlendNode } from './nodes/BlendNode.js';
import { NormalizeNode } from './nodes/NormalizeNode.js';
import { RemapNode } from './nodes/RemapNode.js';
import { DepthOutputNode } from './nodes/DepthOutputNode.js';
import { BiomeOutputNode } from './nodes/BiomeOutputNode.js';
import { WaterOutputNode } from './nodes/WaterOutputNode.js';
import { WaterNode } from './nodes/WaterNode.js';
import { TemperatureNode } from './nodes/TemperatureNode.js';
import { BiomeClassifierNode } from './nodes/BiomeClassifierNode.js';
import { SlopeMapNode } from './nodes/SlopeMapNode.js';
import { FeaturesNode } from './nodes/FeaturesNode.js';
import { FeaturesOutputNode } from './nodes/FeaturesOutputNode.js';
import { TrailsNode } from './nodes/TrailsNode.js';
import { TrailsOutputNode } from './nodes/TrailsOutputNode.js';
import { BlockClassifierNode } from './nodes/BlockClassifierNode.js';
import { BlockMapOutputNode } from './nodes/BlockMapOutputNode.js';
import { HeightLODNode } from './nodes/HeightLODNode.js';
import { ErosionNode } from './nodes/ErosionNode.js';
import { ClassifierNode } from './nodes/ClassifierNode.js';
import { CombineNode } from './nodes/CombineNode.js';
import { SurfaceAnimationNode } from './nodes/SurfaceAnimationNode.js';
import { GradientMapNode } from './nodes/GradientMapNode.js';
import { TerraceNode } from './nodes/TerraceNode.js';
import { MaskNode } from './nodes/MaskNode.js';
import { PowerNode } from './nodes/PowerNode.js';

/**
 * Pipeline Manager
 * Manages execution of the node graph and data flow
 */
export class PipelineManager {
  constructor(gpu, visualizer) {
    this.gpu = gpu;
    this.visualizer = visualizer;
    
    this.resolution = 512; // Default resolution, can be changed
    this.seed = Date.now();
    
    this.outputs = new Map();
    this.nodeResults = new Map();
    
    // Register node types
    this.nodeTypes = new Map();
    this.registerNodeTypes();
  }

  registerNodeTypes() {
    this.nodeTypes.set('PerlinNoise', PerlinNoiseNode);
    this.nodeTypes.set('SeedInput', SeedInputNode);
    this.nodeTypes.set('Blend', BlendNode);
    this.nodeTypes.set('Normalize', NormalizeNode);
    this.nodeTypes.set('Remap', RemapNode);
    this.nodeTypes.set('DepthOutput', DepthOutputNode);
    this.nodeTypes.set('BiomeOutput', BiomeOutputNode);
    this.nodeTypes.set('WaterOutput', WaterOutputNode);
    this.nodeTypes.set('Water', WaterNode);
    this.nodeTypes.set('Temperature', TemperatureNode);
    this.nodeTypes.set('BiomeClassifier', BiomeClassifierNode);
    this.nodeTypes.set('SlopeMap', SlopeMapNode);
    this.nodeTypes.set('Features', FeaturesNode);
    this.nodeTypes.set('FeaturesOutput', FeaturesOutputNode);
    this.nodeTypes.set('Trails', TrailsNode);
    this.nodeTypes.set('TrailsOutput', TrailsOutputNode);
    this.nodeTypes.set('BlockClassifier', BlockClassifierNode);
    this.nodeTypes.set('BlockMapOutput', BlockMapOutputNode);
    this.nodeTypes.set('HeightLOD', HeightLODNode);
    this.nodeTypes.set('Erosion', ErosionNode);
    this.nodeTypes.set('Classifier', ClassifierNode);
    this.nodeTypes.set('Combine', CombineNode);
    this.nodeTypes.set('SurfaceAnimation', SurfaceAnimationNode);
    this.nodeTypes.set('GradientMap', GradientMapNode);
    this.nodeTypes.set('Terrace', TerraceNode);
    this.nodeTypes.set('Mask', MaskNode);
    this.nodeTypes.set('Power', PowerNode);
  }

  getNodeClass(type) {
    return this.nodeTypes.get(type);
  }

  /**
   * Execute the entire graph
   */
  async execute(graph) {
    console.log('Executing pipeline...', graph);
    
    // Clear previous results
    this.nodeResults.clear();
    this.outputs.clear();
    
    // Build execution order (topological sort)
    const order = this.topologicalSort(graph);
    console.log('Execution order:', order);
    
    // Execute nodes in order
    for (const nodeId of order) {
      const nodeData = graph.nodes.find(n => n.id === nodeId);
      if (!nodeData) continue;
      
      console.log(`Executing node: ${nodeData.type} (${nodeId})`);
      
      // Get node class
      const NodeClass = this.nodeTypes.get(nodeData.type);
      if (!NodeClass) {
        console.error(`Unknown node type: ${nodeData.type}`);
        continue;
      }
      
      // Create node instance
      const node = new NodeClass(this.gpu);
      
      // Gather inputs
      const inputs = {};
      const inputConnections = graph.connections.filter(c => c.to === nodeId);
      
      for (const conn of inputConnections) {
        const sourceResult = this.nodeResults.get(conn.from);
        if (sourceResult && sourceResult[conn.output]) {
          inputs[conn.input] = sourceResult[conn.output];
        }
      }
      
      // Execute node
      try {
        const result = await node.process(inputs, {
          ...nodeData.params,
          resolution: this.resolution,
          seed: this.seed
        });
        
        this.nodeResults.set(nodeId, result);
        
        // If this is an output node, store the result
        if (nodeData.type.includes('Output')) {
          const mapType = nodeData.type.replace('Output', '').toLowerCase();
          console.log(`Storing output for '${mapType}':`, {
            type: result.output?.constructor?.name,
            length: result.output?.length,
            sample: result.output?.slice(0, 5)
          });
          this.outputs.set(mapType, {
            data: result.output,
            resolution: this.resolution
          });
        }
      } catch (error) {
        console.error(`Error executing node ${nodeData.type}:`, error);
        throw error;
      }
    }
    
    console.log('Pipeline execution complete');
  }

  /**
   * Execute a single node for preview
   */
  async executeNode(nodeData, graph) {
    console.log(`Previewing node: ${nodeData.type}`);
    
    // Skip only Water during preview (still CPU-based)
    const expensiveNodes = ['Water'];
    if (expensiveNodes.includes(nodeData.type)) {
      console.log(`  Skipping preview for expensive node: ${nodeData.type}`);
      return null;
    }
    
    // Get node class
    const NodeClass = this.nodeTypes.get(nodeData.type);
    if (!NodeClass) {
      throw new Error(`Unknown node type: ${nodeData.type}`);
    }
    
    // Build dependency chain and execute
    const dependencies = this.getNodeDependencies(nodeData.id, graph);
    
    // Execute dependencies first
    for (const depId of dependencies) {
      if (this.nodeResults.has(depId)) continue;
      
      const depNode = graph.nodes.find(n => n.id === depId);
      if (!depNode) continue;
      
      const DepNodeClass = this.nodeTypes.get(depNode.type);
      const depInstance = new DepNodeClass(this.gpu);
      
      // Gather inputs for dependency
      const depInputs = {};
      const depConnections = graph.connections.filter(c => c.to === depId);
      
      for (const conn of depConnections) {
        const sourceResult = this.nodeResults.get(conn.from);
        if (sourceResult && sourceResult[conn.output]) {
          depInputs[conn.input] = sourceResult[conn.output];
        }
      }
      
      const depResult = await depInstance.process(depInputs, {
        ...depNode.params,
        resolution: this.resolution,
        seed: this.seed
      });
      
      this.nodeResults.set(depId, depResult);
    }
    
    // Now execute the target node
    const node = new NodeClass(this.gpu);
    
    // Gather inputs
    const inputs = {};
    const inputConnections = graph.connections.filter(c => c.to === nodeData.id);
    
    for (const conn of inputConnections) {
      const sourceResult = this.nodeResults.get(conn.from);
      if (sourceResult && sourceResult[conn.output]) {
        inputs[conn.input] = sourceResult[conn.output];
      }
    }
    
    // Execute
    const result = await node.process(inputs, {
      ...nodeData.params,
      resolution: this.resolution,
      seed: this.seed
    });
    
    this.nodeResults.set(nodeData.id, result);
    
    // Return the primary output for visualization
    if (result.output) {
      return {
        data: result.output,
        resolution: this.resolution
      };
    }
    
    // Return first available output (check multiple typed array types)
    for (const key in result) {
      if (result[key] instanceof Float32Array || 
          result[key] instanceof Uint8ClampedArray ||
          result[key] instanceof Uint16Array ||
          result[key] instanceof Uint32Array) {
        return {
          data: result[key],
          resolution: this.resolution
        };
      }
    }
    
    // Some nodes (like SurfaceAnimation) don't produce visualizable data
    // Return null to indicate no visualization needed
    if (nodeData.type === 'SurfaceAnimation') {
      return null;
    }
    
    throw new Error('No output data from node');
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
   * Topological sort for execution order
   */
  topologicalSort(graph) {
    const order = [];
    const visited = new Set();
    const temp = new Set();
    
    const visit = (nodeId) => {
      if (temp.has(nodeId)) {
        throw new Error('Cycle detected in graph');
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
      order.unshift(nodeId);
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
   * Get output map data
   */
  getOutput(mapType) {
    return this.outputs.get(mapType);
  }

  /**
   * Set resolution for generation
   */
  setResolution(resolution) {
    this.resolution = resolution;
  }

  /**
   * Set seed for generation
   */
  setSeed(seed) {
    this.seed = seed;
  }
}
