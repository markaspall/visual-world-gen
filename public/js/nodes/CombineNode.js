import { BaseNode } from './BaseNode.js';

/**
 * Combine Node
 * Combines multiple noise layers with different weights
 */
export class CombineNode extends BaseNode {
  static inputs = ['base', 'layer1', 'layer2'];
  static outputs = ['output'];
  static defaultParams = {
    baseWeight: 1.0,
    layer1Weight: 0.5,
    layer2Weight: 0.25
  };

  async process(inputs, params) {
    const base = inputs.base;
    const layer1 = inputs.layer1;
    const layer2 = inputs.layer2;
    
    if (!base) {
      throw new Error('CombineNode requires at least base input');
    }

    const baseWeight = params.baseWeight || 1.0;
    const layer1Weight = params.layer1Weight || 0.5;
    const layer2Weight = params.layer2Weight || 0.25;

    const output = new Float32Array(base.length);
    
    for (let i = 0; i < base.length; i++) {
      let value = base[i] * baseWeight;
      
      if (layer1 && i < layer1.length) {
        value += layer1[i] * layer1Weight;
      }
      
      if (layer2 && i < layer2.length) {
        value += layer2[i] * layer2Weight;
      }
      
      output[i] = value;
    }

    return { output };
  }
}
