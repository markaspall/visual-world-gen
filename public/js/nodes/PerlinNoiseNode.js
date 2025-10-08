import { BaseNode } from './BaseNode.js';

/**
 * Perlin Noise Node
 * Generates 2D Perlin noise using WebGPU
 */
export class PerlinNoiseNode extends BaseNode {
  static inputs = ['seed'];
  static outputs = ['output'];
  static defaultParams = {
    frequency: 4.0,
    octaves: 6,
    persistence: 0.5,
    lacunarity: 2.0,
    scale: 10.0
  };

  async process(inputs, params) {
    const resolution = params.resolution || 512;
    const seed = inputs.seed || params.seed || Date.now();
    const frequency = params.frequency || 1.0;
    const octaves = params.octaves || 4;
    const persistence = params.persistence || 0.5;
    const lacunarity = params.lacunarity || 2.0;
    const scale = params.scale || 1.0;

    // Create output buffer
    const bufferSize = resolution * resolution * 4; // Float32
    const outputBuffer = this.createDataBuffer(bufferSize);

    // Perlin noise shader
    const shaderCode = `
      struct Params {
        resolution: u32,
        seed: u32,
        frequency: f32,
        octaves: u32,
        persistence: f32,
        lacunarity: f32,
        scale: f32,
      }

      @group(0) @binding(0) var<storage, read_write> output: array<f32>;
      @group(0) @binding(1) var<uniform> params: Params;

      // Hash to get pseudo-random gradient direction
      fn hash(p: vec2<f32>) -> f32 {
        return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453123);
      }

      // Get gradient vector for a grid point
      fn getGradient(p: vec2<f32>) -> vec2<f32> {
        let angle = hash(p) * 6.283185307179586; // 2 * PI
        return vec2<f32>(cos(angle), sin(angle));
      }

      // Quintic interpolation (smoother than cubic)
      fn quintic(t: f32) -> f32 {
        return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
      }

      // Classic Perlin Noise (gradient-based)
      fn perlin(p: vec2<f32>) -> f32 {
        let pi = floor(p);
        let pf = fract(p);
        
        // Get gradients at four corners
        let g00 = getGradient(pi + vec2<f32>(0.0, 0.0));
        let g10 = getGradient(pi + vec2<f32>(1.0, 0.0));
        let g01 = getGradient(pi + vec2<f32>(0.0, 1.0));
        let g11 = getGradient(pi + vec2<f32>(1.0, 1.0));
        
        // Compute dot products with distance vectors
        let v00 = dot(g00, pf - vec2<f32>(0.0, 0.0));
        let v10 = dot(g10, pf - vec2<f32>(1.0, 0.0));
        let v01 = dot(g01, pf - vec2<f32>(0.0, 1.0));
        let v11 = dot(g11, pf - vec2<f32>(1.0, 1.0));
        
        // Interpolate
        let sx = quintic(pf.x);
        let sy = quintic(pf.y);
        
        let a = mix(v00, v10, sx);
        let b = mix(v01, v11, sx);
        
        return mix(a, b, sy);
      }

      // Fractal Brownian Motion with Perlin noise
      fn fbm(p: vec2<f32>, octaves: u32, persistence: f32, lacunarity: f32) -> f32 {
        var value = 0.0;
        var amplitude = 1.0;
        var frequency = 1.0;
        var maxValue = 0.0;
        
        for (var i = 0u; i < octaves; i = i + 1u) {
          value += amplitude * perlin(p * frequency);
          maxValue += amplitude;
          amplitude *= persistence;
          frequency *= lacunarity;
        }
        
        // Normalize to approximately [-1, 1], then to [0, 1]
        return (value / maxValue) * 0.5 + 0.5;
      }

      @compute @workgroup_size(16, 16)
      fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let x = global_id.x;
        let y = global_id.y;
        let resolution = params.resolution;
        
        if (x >= resolution || y >= resolution) {
          return;
        }
        
        let idx = y * resolution + x;
        
        // Normalized coordinates
        let nx = f32(x) / f32(resolution);
        let ny = f32(y) / f32(resolution);
        
        // Scale by frequency and params
        let px = nx * params.frequency * params.scale;
        let py = ny * params.frequency * params.scale;
        
        // Add seed offset
        let seed_x = f32(params.seed % 10000u) * 0.001;
        let seed_y = f32((params.seed / 10000u) % 10000u) * 0.001;
        
        let pos = vec2<f32>(px + seed_x, py + seed_y);
        
        // Generate noise
        let noise_value = fbm(pos, params.octaves, params.persistence, params.lacunarity);
        
        output[idx] = noise_value;
      }
    `;

    // Execute shader
    const workgroupsX = Math.ceil(resolution / 16);
    const workgroupsY = Math.ceil(resolution / 16);

    await this.executeShader(
      shaderCode,
      [outputBuffer],
      {
        resolution: resolution,
        seed: seed % 1000000,
        frequency: frequency,
        octaves: octaves,
        persistence: persistence,
        lacunarity: lacunarity,
        scale: scale
      },
      workgroupsX,
      workgroupsY
    );

    // Read back results
    const output = await this.downloadData(outputBuffer, bufferSize);

    // Cleanup
    outputBuffer.destroy();

    return { output };
  }
}
