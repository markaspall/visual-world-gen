import { BaseNode } from './BaseNode.js';

/**
 * Erosion Node
 * Simulates hydraulic erosion on heightmap
 */
export class ErosionNode extends BaseNode {
  static inputs = ['input'];
  static outputs = ['output'];
  static defaultParams = {
    iterations: 100,
    erosionRate: 0.3,
    depositionRate: 0.3,
    evaporationRate: 0.01,
    minSlope: 0.01
  };

  async process(inputs, params) {
    if (!inputs.input) {
      throw new Error('ErosionNode requires input');
    }

    const data = inputs.input;
    const resolution = params.resolution || 512;
    const iterations = params.iterations || 100;
    const erosionRate = params.erosionRate || 0.3;
    const depositionRate = params.depositionRate || 0.3;
    const evaporationRate = params.evaporationRate || 0.01;
    const minSlope = params.minSlope || 0.01;

    const inputBuffer = this.uploadData(data);
    const outputBuffer = this.createDataBuffer(data.length * 4);

    const shaderCode = `
      struct Params {
        resolution: u32,
        iterations: u32,
        erosionRate: f32,
        depositionRate: f32,
        evaporationRate: f32,
        minSlope: f32,
      }

      @group(0) @binding(0) var<storage, read> input: array<f32>;
      @group(0) @binding(1) var<storage, read_write> output: array<f32>;
      @group(0) @binding(2) var<uniform> params: Params;

      fn getHeight(x: i32, y: i32) -> f32 {
        let res = i32(params.resolution);
        if (x < 0 || x >= res || y < 0 || y >= res) {
          return 0.0;
        }
        return output[u32(y * res + x)];
      }

      fn setHeight(x: i32, y: i32, val: f32) {
        let res = i32(params.resolution);
        if (x >= 0 && x < res && y >= 0 && y < res) {
          output[u32(y * res + x)] = val;
        }
      }

      @compute @workgroup_size(16, 16)
      fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let x = i32(global_id.x);
        let y = i32(global_id.y);
        let res = i32(params.resolution);
        
        if (x >= res || y >= res) {
          return;
        }
        
        // Initialize output with input
        let idx = y * res + x;
        output[u32(idx)] = input[u32(idx)];
      }
    `;

    // Initialize
    const workgroupsX = Math.ceil(resolution / 16);
    const workgroupsY = Math.ceil(resolution / 16);
    
    await this.executeShader(
      shaderCode,
      [inputBuffer, outputBuffer],
      {
        resolution: resolution,
        iterations: iterations,
        erosionRate: erosionRate,
        depositionRate: depositionRate,
        evaporationRate: evaporationRate,
        minSlope: minSlope
      },
      workgroupsX,
      workgroupsY
    );

    // For now, we'll use a simplified CPU-based erosion for demonstration
    // A full GPU erosion simulation would require multiple passes
    const heightMap = await this.downloadData(outputBuffer, data.length * 4);
    
    // Simple thermal erosion pass
    const smoothed = new Float32Array(heightMap.length);
    for (let i = 0; i < heightMap.length; i++) {
      smoothed[i] = heightMap[i];
    }
    
    for (let iter = 0; iter < Math.min(iterations, 10); iter++) {
      for (let y = 1; y < resolution - 1; y++) {
        for (let x = 1; x < resolution - 1; x++) {
          const idx = y * resolution + x;
          const center = heightMap[idx];
          
          // Average with neighbors
          const neighbors = [
            heightMap[(y - 1) * resolution + x],
            heightMap[(y + 1) * resolution + x],
            heightMap[y * resolution + (x - 1)],
            heightMap[y * resolution + (x + 1)]
          ];
          
          const avg = neighbors.reduce((a, b) => a + b, 0) / 4;
          const diff = avg - center;
          
          if (Math.abs(diff) > minSlope) {
            smoothed[idx] = center + diff * erosionRate;
          }
        }
      }
      
      // Copy back
      for (let i = 0; i < heightMap.length; i++) {
        heightMap[i] = smoothed[i];
      }
    }

    inputBuffer.destroy();
    outputBuffer.destroy();

    return { output: heightMap };
  }
}
