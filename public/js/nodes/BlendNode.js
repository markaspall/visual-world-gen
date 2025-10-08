import { BaseNode } from './BaseNode.js';

/**
 * Blend Node
 * Blends two inputs using various operations
 */
export class BlendNode extends BaseNode {
  static inputs = ['input1', 'input2'];
  static outputs = ['output'];
  static defaultParams = {
    operation: 'add', // add, multiply, subtract, lerp, min, max
    weight: 0.5
  };

  async process(inputs, params) {
    if (!inputs.input1 || !inputs.input2) {
      throw new Error('BlendNode requires two inputs');
    }

    const data1 = inputs.input1;
    const data2 = inputs.input2;
    const operation = params.operation || 'add';
    const weight = params.weight || 0.5;

    if (data1.length !== data2.length) {
      throw new Error('Input data must have same length');
    }

    const input1Buffer = this.uploadData(data1);
    const input2Buffer = this.uploadData(data2);
    const outputBuffer = this.createDataBuffer(data1.length * 4);

    // Map operation to shader code
    const opCode = this.getOperationCode(operation);

    const shaderCode = `
      struct Params {
        count: u32,
        weight: f32,
      }

      @group(0) @binding(0) var<storage, read> input1: array<f32>;
      @group(0) @binding(1) var<storage, read> input2: array<f32>;
      @group(0) @binding(2) var<storage, read_write> output: array<f32>;
      @group(0) @binding(3) var<uniform> params: Params;

      @compute @workgroup_size(256)
      fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let idx = global_id.x;
        
        if (idx >= params.count) {
          return;
        }

        let a = input1[idx];
        let b = input2[idx];
        let w = params.weight;
        
        ${opCode}
      }
    `;

    const workgroups = Math.ceil(data1.length / 256);
    await this.executeShader(
      shaderCode,
      [input1Buffer, input2Buffer, outputBuffer],
      {
        count: data1.length,
        weight: weight
      },
      workgroups
    );

    const output = await this.downloadData(outputBuffer, data1.length * 4);

    input1Buffer.destroy();
    input2Buffer.destroy();
    outputBuffer.destroy();

    return { output };
  }

  getOperationCode(operation) {
    switch (operation) {
      case 'add':
        return 'output[idx] = a + b;';
      case 'subtract':
        return 'output[idx] = a - b;';
      case 'multiply':
        return 'output[idx] = a * b;';
      case 'lerp':
        return 'output[idx] = mix(a, b, w);';
      case 'min':
        return 'output[idx] = min(a, b);';
      case 'max':
        return 'output[idx] = max(a, b);';
      default:
        return 'output[idx] = a + b;';
    }
  }
}
