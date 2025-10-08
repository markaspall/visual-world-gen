import { BaseNode } from './BaseNode.js';

export class FeaturesOutputNode extends BaseNode {
  static inputs = ['input'];
  static outputs = ['output'];
  static defaultParams = {};

  async process(inputs, params) {
    if (!inputs.input) {
      throw new Error('FeaturesOutputNode requires input');
    }
    return { output: inputs.input };
  }
}
