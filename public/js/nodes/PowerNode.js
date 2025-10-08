import { BaseNode } from './BaseNode.js';

/**
 * Power Node
 * Applies power curve to reshape distribution
 */
export class PowerNode extends BaseNode {
  static inputs = ['input'];
  static outputs = ['output'];
  static defaultParams = {
    exponent: 2.0
  };

  async process(inputs, params) {
    if (!inputs.input) {
      throw new Error('PowerNode requires input');
    }

    const data = inputs.input;
    const exponent = params.exponent || 2.0;

    const output = new Float32Array(data.length);
    
    for (let i = 0; i < data.length; i++) {
      output[i] = Math.pow(Math.max(0, data[i]), exponent);
    }

    return { output };
  }
}
