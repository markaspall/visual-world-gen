import { BaseNode } from './BaseNode.js';

/**
 * Depth Output Node
 * Marks data as depth/elevation output
 */
export class DepthOutputNode extends BaseNode {
  static inputs = ['input'];
  static outputs = ['output'];
  static defaultParams = {};

  async process(inputs, params) {
    if (!inputs.input) {
      throw new Error('DepthOutputNode requires input');
    }

    // Pass through the data
    return { output: inputs.input };
  }
}
