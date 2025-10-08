import { BaseNode } from './BaseNode.js';

/**
 * Seed Input Node
 * Provides a seed value to other nodes
 */
export class SeedInputNode extends BaseNode {
  static inputs = [];
  static outputs = ['seed'];
  static defaultParams = {
    value: Date.now()
  };

  async process(inputs, params) {
    const seed = params.value || Date.now();
    const resolution = params.resolution || 512;
    
    // Create a simple data array with the seed value for visualization
    const data = new Float32Array(resolution * resolution);
    const normalizedSeed = (seed % 10000) / 10000; // Normalize for display
    data.fill(normalizedSeed);
    
    return {
      seed: seed,
      output: data // Add this for preview
    };
  }
}
