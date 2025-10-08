import { BaseNode } from './BaseNode.js';

/**
 * Classifier Node
 * Classifies values into discrete categories (e.g., biomes)
 */
export class ClassifierNode extends BaseNode {
  static inputs = ['input'];
  static outputs = ['output'];
  static defaultParams = {
    thresholds: [0.2, 0.4, 0.6, 0.8],
    values: [0.0, 0.25, 0.5, 0.75, 1.0]
  };

  async process(inputs, params) {
    if (!inputs.input) {
      throw new Error('ClassifierNode requires input');
    }

    const data = inputs.input;
    const thresholds = params.thresholds || [0.2, 0.4, 0.6, 0.8];
    const values = params.values || [0.0, 0.25, 0.5, 0.75, 1.0];

    // Classify on CPU (simple enough)
    const output = new Float32Array(data.length);
    
    for (let i = 0; i < data.length; i++) {
      const val = data[i];
      let category = 0;
      
      for (let j = 0; j < thresholds.length; j++) {
        if (val >= thresholds[j]) {
          category = j + 1;
        } else {
          break;
        }
      }
      
      output[i] = values[category];
    }

    return { output };
  }
}
