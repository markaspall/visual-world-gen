import { BaseNode } from './BaseNode.js';

/**
 * Terrace Node
 * Creates terraced/stepped terrain
 */
export class TerraceNode extends BaseNode {
  static inputs = ['input'];
  static outputs = ['output'];
  static defaultParams = {
    steps: 5,
    smoothness: 0.1
  };

  async process(inputs, params) {
    if (!inputs.input) {
      throw new Error('TerraceNode requires input');
    }

    const data = inputs.input;
    const steps = params.steps || 5;
    const smoothness = params.smoothness || 0.1;

    const output = new Float32Array(data.length);
    
    for (let i = 0; i < data.length; i++) {
      const value = data[i];
      
      // Create stepped terrain
      const stepped = Math.floor(value * steps) / steps;
      
      // Smooth the steps slightly
      const smooth = value * steps - Math.floor(value * steps);
      const smoothed = stepped + smooth * smoothness;
      
      output[i] = Math.max(0, Math.min(1, smoothed));
    }

    return { output };
  }
}
