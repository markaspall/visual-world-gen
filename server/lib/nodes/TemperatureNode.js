import { BaseNode } from './BaseNode.js';

/**
 * Temperature Node - Server-side
 * Generates temperature map influenced by latitude and elevation
 * Simplified version using CPU noise
 */
export class TemperatureNode extends BaseNode {
  static inputs = ['seed', 'height'];
  static outputs = ['output'];
  static defaultParams = {
    elevationInfluence: 0.3,
    latitudeInfluence: 0.2
  };

  async process(inputs, params) {
    const resolution = params.resolution || 512;
    
    // Handle seed input - could be a number or noise data from another node
    let seedValue = params.seed || Date.now();
    if (inputs.seed) {
      // If seed input is a Float32Array (noise from another node), use first value
      if (inputs.seed instanceof Float32Array || inputs.seed instanceof Uint8Array) {
        seedValue = inputs.seed[0] * 10000; // Convert to reasonable seed value
      } else if (typeof inputs.seed === 'number') {
        seedValue = inputs.seed;
      }
    }
    
    const heightMap = inputs.height || new Float32Array(resolution * resolution).fill(0.5);
    
    const elevationInfluence = params.elevationInfluence || 0.3;
    const latitudeInfluence = params.latitudeInfluence || 0.2;

    const output = new Float32Array(resolution * resolution);

    // Generate temperature map
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const idx = y * resolution + x;
        
        // Base temperature (warm)
        let temp = 0.7;
        
        // Latitude effect (cooler at poles)
        const latitude = Math.abs(y / resolution - 0.5) * 2; // 0 at equator, 1 at poles
        temp -= latitude * latitudeInfluence;
        
        // Elevation effect (cooler at high altitudes)
        const height = heightMap[idx];
        temp -= height * elevationInfluence;
        
        // Simple noise for variation
        const noise = this.simpleNoise(x * 0.01 + seedValue * 0.001, y * 0.01 + seedValue * 0.001);
        temp += noise * 0.1;
        
        // Clamp to [0, 1]
        output[idx] = Math.max(0, Math.min(1, temp));
      }
    }

    return { output };
  }

  simpleNoise(x, y) {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }
}
