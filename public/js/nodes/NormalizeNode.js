import { BaseNode } from './BaseNode.js';

/**
 * Normalize Node
 * Normalizes input data to [min, max] range
 * Can passthrough data unchanged if passthrough is enabled
 */
export class NormalizeNode extends BaseNode {
  static inputs = ['input'];
  static outputs = ['output'];
  static defaultParams = {
    min: 0.0,
    max: 1.0,
    passthrough: false
  };

  async process(inputs, params) {
    if (!inputs.input) {
      throw new Error('NormalizeNode requires input');
    }

    const data = inputs.input;
    const resolution = params.resolution || 512;
    const targetMin = params.min || 0.0;
    const targetMax = params.max || 1.0;
    const passthrough = params.passthrough || false;
    
    // Passthrough mode - return data unchanged
    if (passthrough) {
      console.log('NormalizeNode: Passthrough enabled, skipping normalization');
      return { output: data };
    }

    // Find min/max
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < data.length; i++) {
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
    }

    // Normalize using GPU
    const inputBuffer = this.uploadData(data);
    const outputBuffer = this.createDataBuffer(data.length * 4);

    const shaderCode = `
      struct Params {
        count: u32,
        minVal: f32,
        maxVal: f32,
        targetMin: f32,
        targetMax: f32,
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
        let range = params.maxVal - params.minVal;
        
        var normalized: f32;
        if (range > 0.0001) {
          normalized = (val - params.minVal) / range;
        } else {
          normalized = 0.5;
        }
        
        let scaled = normalized * (params.targetMax - params.targetMin) + params.targetMin;
        output[idx] = scaled;
      }
    `;

    const workgroups = Math.ceil(data.length / 256);
    
    await this.executeShader(
      shaderCode,
      [inputBuffer, outputBuffer],
      {
        count: data.length,
        minVal: min,
        maxVal: max,
        targetMin: targetMin,
        targetMax: targetMax
      },
      workgroups
    );

    const output = await this.downloadData(outputBuffer, data.length * 4);

    inputBuffer.destroy();
    outputBuffer.destroy();

    return { output };
  }
}
