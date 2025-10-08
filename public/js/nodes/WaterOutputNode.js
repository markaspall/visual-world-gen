import { BaseNode } from './BaseNode.js';

/**
 * Water Output Node
 * Marks data as water level output
 */
export class WaterOutputNode extends BaseNode {
  static inputs = ['input'];
  static outputs = ['output'];
  static defaultParams = {};

  async process(inputs, params) {
    if (!inputs.input) {
      throw new Error('WaterOutputNode requires input');
    }

    // Pass through the data
    return { output: inputs.input };
  }
}
