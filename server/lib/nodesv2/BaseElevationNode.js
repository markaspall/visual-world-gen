import { BaseNode } from '../nodes/BaseNode.js';

/**
 * Base Elevation Node - LOD 0 (128×128)
 * Multi-octave Perlin noise for continental-scale terrain
 */
export class BaseElevationNode extends BaseNode {
  static inputs = ['seed'];
  static outputs = ['elevation'];
  static defaultParams = {
    resolution: 128,  // LOD 0 resolution
    continentalFreq: 0.0005,
    continentalWeight: 0.6,
    regionalFreq: 0.002,
    regionalWeight: 0.3,
    localFreq: 0.01,
    localWeight: 0.1
  };

  async process(inputs, params) {
    const resolution = params.resolution || 128;
    const seed = inputs.seed || params.seed || Date.now();
    const offsetX = params.offsetX || 0;
    const offsetZ = params.offsetZ || 0;

    // Create output buffer
    const bufferSize = resolution * resolution * 4; // Float32
    const outputBuffer = this.createDataBuffer(bufferSize);

    const shaderCode = `
      struct Params {
        resolution: u32,
        seed: u32,
        continentalFreq: f32,
        continentalWeight: f32,
        regionalFreq: f32,
        regionalWeight: f32,
        localFreq: f32,
        localWeight: f32,
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
        
        let g00 = getGradient(pi + vec2<f32>(0.0, 0.0));
        let g10 = getGradient(pi + vec2<f32>(1.0, 0.0));
        let g01 = getGradient(pi + vec2<f32>(0.0, 1.0));
        let g11 = getGradient(pi + vec2<f32>(1.0, 1.0));
        
        let v00 = dot(g00, pf - vec2<f32>(0.0, 0.0));
        let v10 = dot(g10, pf - vec2<f32>(1.0, 0.0));
        let v01 = dot(g01, pf - vec2<f32>(0.0, 1.0));
        let v11 = dot(g11, pf - vec2<f32>(1.0, 1.0));
        
        let sx = quintic(pf.x);
        let sy = quintic(pf.y);
        
        let a = mix(v00, v10, sx);
        let b = mix(v01, v11, sx);
        
        return mix(a, b, sy);
      }

      @compute @workgroup_size(8, 8)
      fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let x = global_id.x;
        let y = global_id.y;
        
        if (x >= params.resolution || y >= params.resolution) {
          return;
        }
        
        let idx = y * params.resolution + x;
        
        // World coordinates (LOD 0 covers 512×512 at 4:1 scale)
        let worldX = (f32(x) + params.offsetX) * 4.0;
        let worldZ = (f32(y) + params.offsetZ) * 4.0;
        
        // Seed offset for variation
        let seed_x = f32(params.seed % 10000u) * 0.001;
        let seed_y = f32((params.seed / 10000u) % 10000u) * 0.001;
        
        // Continental scale (large features)
        let continentalPos = vec2<f32>(worldX * params.continentalFreq + seed_x, 
                                        worldZ * params.continentalFreq + seed_y);
        let continental = perlin(continentalPos);
        
        // Regional scale (medium features)
        let regionalPos = vec2<f32>(worldX * params.regionalFreq + seed_x + 100.0, 
                                     worldZ * params.regionalFreq + seed_y + 100.0);
        let regional = perlin(regionalPos);
        
        // Local scale (small features)
        let localPos = vec2<f32>(worldX * params.localFreq + seed_x + 200.0, 
                                 worldZ * params.localFreq + seed_y + 200.0);
        let local = perlin(localPos);
        
        // Weighted combination
        var elevation = continental * params.continentalWeight + 
                       regional * params.regionalWeight + 
                       local * params.localWeight;
        
        // Normalize to 0-1 range (Perlin is approximately -0.5 to 0.5)
        elevation = (elevation + 0.5);
        elevation = clamp(elevation, 0.0, 1.0);
        
        output[idx] = elevation;
      }
    `;

    // Execute shader
    const workgroupsX = Math.ceil(resolution / 8);
    const workgroupsY = Math.ceil(resolution / 8);

    await this.executeShader(
      shaderCode,
      [outputBuffer],
      {
        resolution,
        seed: seed % 1000000,
        continentalFreq: params.continentalFreq,
        continentalWeight: params.continentalWeight,
        regionalFreq: params.regionalFreq,
        regionalWeight: params.regionalWeight,
        localFreq: params.localFreq,
        localWeight: params.localWeight,
        offsetX,
        offsetZ
      },
      workgroupsX,
      workgroupsY
    );

    // Read back results
    const elevation = await this.downloadData(outputBuffer, bufferSize);

    // Cleanup
    outputBuffer.destroy();

    console.log(`✅ BaseElevation generated (${resolution}×${resolution})`);
    return { elevation };
  }
}
