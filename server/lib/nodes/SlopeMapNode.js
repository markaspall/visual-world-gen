import { BaseNode } from './BaseNode.js';

/**
 * Slope Map Node - Server-side
 * Calculates gradient/slope from height map
 */
export class SlopeMapNode extends BaseNode {
  static inputs = ['height'];
  static outputs = ['magnitude', 'directionX', 'directionY'];
  static defaultParams = {};

  async process(inputs, params) {
    const resolution = params.resolution || 512;
    const heightMap = inputs.height;

    if (!heightMap) {
      throw new Error('SlopeMapNode requires height input');
    }

    const magnitude = new Float32Array(resolution * resolution);
    const directionX = new Float32Array(resolution * resolution);
    const directionY = new Float32Array(resolution * resolution);

    // Calculate gradients using Sobel operator
    for (let y = 1; y < resolution - 1; y++) {
      for (let x = 1; x < resolution - 1; x++) {
        const idx = y * resolution + x;

        // Sample 3x3 neighborhood
        const h00 = heightMap[(y - 1) * resolution + (x - 1)];
        const h10 = heightMap[(y - 1) * resolution + x];
        const h20 = heightMap[(y - 1) * resolution + (x + 1)];
        const h01 = heightMap[y * resolution + (x - 1)];
        const h21 = heightMap[y * resolution + (x + 1)];
        const h02 = heightMap[(y + 1) * resolution + (x - 1)];
        const h12 = heightMap[(y + 1) * resolution + x];
        const h22 = heightMap[(y + 1) * resolution + (x + 1)];

        // Sobel operator
        const dx = (h20 + 2 * h21 + h22) - (h00 + 2 * h01 + h02);
        const dy = (h02 + 2 * h12 + h22) - (h00 + 2 * h10 + h20);

        // Calculate magnitude
        const mag = Math.sqrt(dx * dx + dy * dy);

        magnitude[idx] = mag;
        directionX[idx] = dx;
        directionY[idx] = dy;
      }
    }

    // Handle borders (copy from neighbors)
    for (let x = 0; x < resolution; x++) {
      magnitude[x] = magnitude[resolution + x]; // Top row
      magnitude[(resolution - 1) * resolution + x] = magnitude[(resolution - 2) * resolution + x]; // Bottom row
    }
    for (let y = 0; y < resolution; y++) {
      magnitude[y * resolution] = magnitude[y * resolution + 1]; // Left column
      magnitude[y * resolution + resolution - 1] = magnitude[y * resolution + resolution - 2]; // Right column
    }

    return {
      magnitude,
      directionX,
      directionY
    };
  }
}
