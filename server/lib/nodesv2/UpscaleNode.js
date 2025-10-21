import { BaseNode } from '../nodes/BaseNode.js';

/**
 * Upscale Node - LOD 0 (128×128) → LOD 1 (512×512)
 * Bicubic interpolation for smooth upscaling
 */
export class UpscaleNode extends BaseNode {
  static inputs = ['input'];
  static outputs = ['output'];
  static defaultParams = {
    inputResolution: 128,
    outputResolution: 512
  };

  async process(inputs, params) {
    const inputRes = params.inputResolution || 128;
    const outputRes = params.outputResolution || 512;
    const inputData = inputs.input;

    const outputSize = outputRes * outputRes * 4;
    const outputBuffer = this.createDataBuffer(outputSize);

    // Upload input data to GPU buffer
    const inputSize = inputRes * inputRes * 4;
    const inputBuffer = this.createDataBuffer(inputSize);
    this.device.queue.writeBuffer(inputBuffer, 0, inputData.buffer);

    const shaderCode = `
      struct Params {
        inputResolution: u32,
        outputResolution: u32,
      }

      @group(0) @binding(0) var<storage, read> input: array<f32>;
      @group(0) @binding(1) var<storage, read_write> output: array<f32>;
      @group(0) @binding(2) var<uniform> params: Params;

      // Bilinear interpolation
      fn sampleBilinear(u: f32, v: f32) -> f32 {
        let inputRes = f32(params.inputResolution);
        
        // Map to input coordinates
        let x = u * inputRes;
        let y = v * inputRes;
        
        // Get integer and fractional parts
        let x0 = floor(x);
        let y0 = floor(y);
        let fx = fract(x);
        let fy = fract(y);
        
        let x1 = min(x0 + 1.0, inputRes - 1.0);
        let y1 = min(y0 + 1.0, inputRes - 1.0);
        
        // Sample four corners
        let v00 = input[u32(y0) * params.inputResolution + u32(x0)];
        let v10 = input[u32(y0) * params.inputResolution + u32(x1)];
        let v01 = input[u32(y1) * params.inputResolution + u32(x0)];
        let v11 = input[u32(y1) * params.inputResolution + u32(x1)];
        
        // Bilinear interpolation
        let v0 = mix(v00, v10, fx);
        let v1 = mix(v01, v11, fx);
        
        return mix(v0, v1, fy);
      }

      @compute @workgroup_size(16, 16)
      fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let x = global_id.x;
        let y = global_id.y;
        
        if (x >= params.outputResolution || y >= params.outputResolution) {
          return;
        }
        
        let idx = y * params.outputResolution + x;
        
        // Map to 0-1 coordinates
        let u = f32(x) / f32(params.outputResolution - 1u);
        let v = f32(y) / f32(params.outputResolution - 1u);
        
        // Sample with bilinear interpolation
        let value = sampleBilinear(u, v);
        
        output[idx] = value;
      }
    `;

    const workgroupsX = Math.ceil(outputRes / 16);
    const workgroupsY = Math.ceil(outputRes / 16);

    await this.executeShader(
      shaderCode,
      [inputBuffer, outputBuffer],
      {
        inputResolution: inputRes,
        outputResolution: outputRes
      },
      workgroupsX,
      workgroupsY
    );

    const upscaledData = await this.downloadData(outputBuffer, outputSize);

    inputBuffer.destroy();
    outputBuffer.destroy();

    console.log(`✅ Upscaled ${inputRes}×${inputRes} → ${outputRes}×${outputRes}`);
    return { output: upscaledData };
  }
}
