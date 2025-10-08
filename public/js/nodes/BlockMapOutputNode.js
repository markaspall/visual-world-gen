import { BaseNode } from './BaseNode.js';

export class BlockMapOutputNode extends BaseNode {
  static inputs = ['input'];
  static outputs = ['output'];
  static defaultParams = {};

  async process(inputs, params) {
    if (!inputs.input) {
      throw new Error('BlockMapOutputNode requires input');
    }
    return { output: inputs.input };
  }
}
