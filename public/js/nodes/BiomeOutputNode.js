import { BaseNode } from './BaseNode.js';

/**
 * Biome Output Node
 * Marks data as biome output
 */
export class BiomeOutputNode extends BaseNode {
  static inputs = ['input'];
  static outputs = ['output'];
  static defaultParams = {};

  async process(inputs, params) {
    if (!inputs.input) {
      throw new Error('BiomeOutputNode requires input');
    }

    // Pass through the data
    return { output: inputs.input };
  }
}
