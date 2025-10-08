import { BaseNode } from './BaseNode.js';

/**
 * Remap Node
 * Remaps values from one range to another
 */
export class RemapNode extends BaseNode {
  static inputs = ['input'];
  static outputs = ['output'];
  static defaultParams = {
    inputMin: 0.0,
    inputMax: 1.0,
    outputMin: 0.0,
    outputMax: 1.0
  };

  async process(inputs, params) {
    if (!inputs.input) {
      throw new Error('RemapNode requires input');
    }

    const data = inputs.input;
    const inputMin = params.inputMin || 0.0;
    const inputMax = params.inputMax || 1.0;
    const outputMin = params.outputMin || 0.0;
    const outputMax = params.outputMax || 1.0;

    const inputBuffer = this.uploadData(data);
    const outputBuffer = this.createDataBuffer(data.length * 4);

    const shaderCode = `
      struct Params {
        count: u32,
        inputMin: f32,
        inputMax: f32,
        outputMin: f32,
        outputMax: f32,
      }

      @group(0) @binding(0) var<storage, read> input: array<f32>;
      @group(0) @binding(1) var<storage, read_write> output: array<f32>;
      @group(0) @binding(2) var<uniform> params: Params;

      @compute @workgroup_size(256)
      fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let idx = global_id.x;
        
        if (idx >= params.count) {
          return;
        }

        let val = input[idx];
        let normalized = (val - params.inputMin) / (params.inputMax - params.inputMin);
        let remapped = normalized * (params.outputMax - params.outputMin) + params.outputMin;
        
        output[idx] = clamp(remapped, params.outputMin, params.outputMax);
      }
    `;

    const workgroups = Math.ceil(data.length / 256);
    await this.executeShader(
      shaderCode,
      [inputBuffer, outputBuffer],
      {
        count: data.length,
        inputMin: inputMin,
        inputMax: inputMax,
        outputMin: outputMin,
        outputMax: outputMax
      },
      workgroups
    );

    const output = await this.downloadData(outputBuffer, data.length * 4);

    inputBuffer.destroy();
    outputBuffer.destroy();

    return { output };
  }
}
