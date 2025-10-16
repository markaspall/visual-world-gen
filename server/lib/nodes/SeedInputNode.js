import { BaseNode } from './BaseNode.js';

/**
 * Seed Input Node - Server-side
 * Provides a seed value to other nodes
 */
export class SeedInputNode extends BaseNode {
  static inputs = [];
  static outputs = ['seed'];
  static defaultParams = {
    value: Date.now()
  };

  async process(inputs, params) {
    const seed = params.value || params.seed || Date.now();
    
    return {
      seed: seed
    };
  }
}
