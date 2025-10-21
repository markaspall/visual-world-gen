import { BaseNode } from '../nodes/BaseNode.js';

/**
 * Pre-Erosion Moisture Node - LOD 0 (128×128)
 * Moisture map used to guide erosion simulation
 */
export class PreErosionMoistureNode extends BaseNode {
  static inputs = ['seed'];
  static outputs = ['moisture'];
  static defaultParams = {
    resolution: 128,
    frequency: 0.001,
    octaves: 3,
    persistence: 0.5
  };

  async process(inputs, params) {
    const resolution = params.resolution || 128;
    const seed = inputs.seed || params.seed || Date.now();
    const offsetX = params.offsetX || 0;
    const offsetZ = params.offsetZ || 0;

    const bufferSize = resolution * resolution * 4;
    const outputBuffer = this.createDataBuffer(bufferSize);

    const shaderCode = `
      struct Params {
        resolution: u32,
        seed: u32,
        frequency: f32,
        octaves: u32,
        persistence: f32,
        offsetX: f32,
        offsetZ: f32,
      }

      @group(0) @binding(0) var<storage, read_write> output: array<f32>;
      @group(0) @binding(1) var<uniform> params: Params;

      fn hash(p: vec2<f32>) -> f32 {
        return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453123);
      }

      fn getGradient(p: vec2<f32>) -> vec2<f32> {
        let angle = hash(p) * 6.283185307179586;
        return vec2<f32>(cos(angle), sin(angle));
      }

      fn quintic(t: f32) -> f32 {
        return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
      }

      fn perlin(p: vec2<f32>) -> f32 {
        let pi = floor(p);
        let pf = fract(p);
        
        let g00 = getGradient(pi);
        let g10 = getGradient(pi + vec2<f32>(1.0, 0.0));
        let g01 = getGradient(pi + vec2<f32>(0.0, 1.0));
        let g11 = getGradient(pi + vec2<f32>(1.0, 1.0));
        
        let v00 = dot(g00, pf);
        let v10 = dot(g10, pf - vec2<f32>(1.0, 0.0));
        let v01 = dot(g01, pf - vec2<f32>(0.0, 1.0));
        let v11 = dot(g11, pf - vec2<f32>(1.0, 1.0));
        
        let sx = quintic(pf.x);
        let sy = quintic(pf.y);
        
        return mix(mix(v00, v10, sx), mix(v01, v11, sx), sy);
      }

      fn fbm(p: vec2<f32>, octaves: u32, persistence: f32) -> f32 {
        var value = 0.0;
        var amplitude = 1.0;
        var frequency = 1.0;
        var maxValue = 0.0;
        
        for (var i = 0u; i < octaves; i++) {
          value += amplitude * perlin(p * frequency);
          maxValue += amplitude;
          amplitude *= persistence;
          frequency *= 2.0;
        }
        
        return value / maxValue;
      }

      @compute @workgroup_size(8, 8)
      fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let x = global_id.x;
        let y = global_id.y;
        
        if (x >= params.resolution || y >= params.resolution) {
          return;
        }
        
        let idx = y * params.resolution + x;
        
        // World coordinates
        let worldX = (f32(x) + params.offsetX) * 4.0;
        let worldZ = (f32(y) + params.offsetZ) * 4.0;
        
        // Use different seed offset (1000) for moisture
        let seed_x = f32((params.seed + 1000u) % 10000u) * 0.001;
        let seed_y = f32(((params.seed + 1000u) / 10000u) % 10000u) * 0.001;
        
        let pos = vec2<f32>(worldX * params.frequency + seed_x,
                           worldZ * params.frequency + seed_y);
        
        var moisture = fbm(pos, params.octaves, params.persistence);
        
        // Normalize to 0-1
        moisture = (moisture + 0.5);
        moisture = clamp(moisture, 0.0, 1.0);
        
        output[idx] = moisture;
      }
    `;

    const workgroupsX = Math.ceil(resolution / 8);
    const workgroupsY = Math.ceil(resolution / 8);

    await this.executeShader(
      shaderCode,
      [outputBuffer],
      {
        resolution,
        seed: seed % 1000000,
        frequency: params.frequency,
        octaves: params.octaves,
        persistence: params.persistence,
        offsetX,
        offsetZ
      },
      workgroupsX,
      workgroupsY
    );

    const moisture = await this.downloadData(outputBuffer, bufferSize);
    outputBuffer.destroy();

    console.log(`✅ PreErosionMoisture generated (${resolution}×${resolution})`);
    return { moisture };
  }
}
