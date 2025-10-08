import { BaseNode } from './BaseNode.js';

/**
 * Gradient Map Node
 * Applies a gradient mapping to create terrain features
 */
export class GradientMapNode extends BaseNode {
  static inputs = ['input', 'gradient'];
  static outputs = ['output'];
  static defaultParams = {
    steepness: 2.0,
    offset: 0.0
  };

  async process(inputs, params) {
    if (!inputs.input) {
      throw new Error('GradientMapNode requires input');
    }

    const data = inputs.input;
    const gradient = inputs.gradient || data; // Use input as gradient if not provided
    const steepness = params.steepness || 2.0;
    const offset = params.offset || 0.0;

    const output = new Float32Array(data.length);
    
    for (let i = 0; i < data.length; i++) {
      const value = data[i];
      const grad = gradient[i];
      
      // Apply power curve based on gradient
      const mapped = Math.pow(value, steepness) * grad + offset;
      output[i] = Math.max(0, Math.min(1, mapped));
    }

    return { output };
  }
}
