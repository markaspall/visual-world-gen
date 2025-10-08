import { BaseNode } from './BaseNode.js';

export class TrailsOutputNode extends BaseNode {
  static inputs = ['input'];
  static outputs = ['output'];
  static defaultParams = {};

  async process(inputs, params) {
    if (!inputs.input) {
      throw new Error('TrailsOutputNode requires input');
    }
    return { output: inputs.input };
  }
}
