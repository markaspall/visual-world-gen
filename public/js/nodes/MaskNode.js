import { BaseNode } from './BaseNode.js';

/**
 * Mask Node
 * Uses a mask to blend between two inputs
 */
export class MaskNode extends BaseNode {
  static inputs = ['input1', 'input2', 'mask'];
  static outputs = ['output'];
  static defaultParams = {
    threshold: 0.5,
    feather: 0.1
  };

  async process(inputs, params) {
    if (!inputs.input1 || !inputs.mask) {
      throw new Error('MaskNode requires input1 and mask');
    }

    const input1 = inputs.input1;
    const input2 = inputs.input2 || new Float32Array(input1.length).fill(0);
    const mask = inputs.mask;
    const threshold = params.threshold || 0.5;
    const feather = params.feather || 0.1;

    const output = new Float32Array(input1.length);
    
    for (let i = 0; i < input1.length; i++) {
      let maskValue = mask[i];
      
      // Apply threshold and feathering
      if (feather > 0) {
        const dist = (maskValue - threshold) / feather;
        maskValue = Math.max(0, Math.min(1, dist * 0.5 + 0.5));
      } else {
        maskValue = maskValue >= threshold ? 1.0 : 0.0;
      }
      
      output[i] = input1[i] * (1 - maskValue) + input2[i] * maskValue;
    }

    return { output };
  }
}
