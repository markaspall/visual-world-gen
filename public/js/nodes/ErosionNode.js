import { BaseNode } from './BaseNode.js';

/**
 * Erosion Node
 * Simulates hydraulic erosion on heightmap using water droplet simulation (CPU-based)
 * Creates realistic valleys, drainage patterns, and sediment deposition for rivers/lakes
 * 
 * Parameters:
 * - iterations: Number of water droplets to simulate (5000-50000, more = more erosion)
 * - erosionRate: How much sediment is picked up (0.3-0.7)
 * - depositionRate: How much sediment is dropped (0.3-0.5)
 * - evaporationRate: Water loss per step (0.01-0.05)
 * - sedimentCapacity: Max sediment per droplet (3-10, higher = deeper valleys)
 * - inertia: Droplet momentum (0.05 = sharp turns, 0.3 = smooth flow)
 * - erosionRadius: Erosion spread (1-3 pixels)
 * - maxSteps: Droplet lifetime (30-64, longer = wider valleys)
 */
export class ErosionNode extends BaseNode {
  static inputs = ['input'];
  static outputs = ['output'];
  static defaultParams = {
    iterations: 10000,
    erosionRate: 0.5,
    depositionRate: 0.3,
    evaporationRate: 0.02,
    sedimentCapacity: 4.0,
    inertia: 0.1,
    erosionRadius: 2,
    maxSteps: 48
  };

  async process(inputs, params) {
    if (!inputs.input) {
      throw new Error('ErosionNode requires input');
    }

    const data = inputs.input;
    const resolution = params.resolution || 512;
    const iterations = params.iterations || 10000;
    const erosionRate = params.erosionRate || 0.5;
    const depositionRate = params.depositionRate || 0.3;
    const evaporationRate = params.evaporationRate || 0.02;
    const sedimentCapacity = params.sedimentCapacity || 4.0;
    const inertia = params.inertia || 0.1;
    const erosionRadius = Math.floor(params.erosionRadius || 2);
    const maxSteps = params.maxSteps || 48;

    console.log('Hydraulic erosion (CPU):', { resolution, iterations });
    const startTime = performance.now();

    // Copy heightmap for modification
    const heightMap = new Float32Array(data);
    const originalHeight = new Float32Array(data);
    
    // Calculate initial statistics
    let initialMin = Infinity;
    let initialMax = -Infinity;
    let initialSum = 0;
    for (let i = 0; i < originalHeight.length; i++) {
      const val = originalHeight[i];
      initialMin = Math.min(initialMin, val);
      initialMax = Math.max(initialMax, val);
      initialSum += val;
    }
    const initialAvg = initialSum / originalHeight.length;
    
    // Helper functions
    const getHeight = (x, y) => {
      if (x < 0 || x >= resolution || y < 0 || y >= resolution) return 0;
      return heightMap[y * resolution + x];
    };
    
    const setHeight = (x, y, value) => {
      if (x < 0 || x >= resolution || y < 0 || y >= resolution) return;
      heightMap[y * resolution + x] = value;
    };
    
    // Bilinear interpolation for smooth height lookup
    const getHeightInterpolated = (x, y) => {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const xf = x - xi;
      const yf = y - yi;
      
      const h00 = getHeight(xi, yi);
      const h10 = getHeight(xi + 1, yi);
      const h01 = getHeight(xi, yi + 1);
      const h11 = getHeight(xi + 1, yi + 1);
      
      const h0 = h00 * (1 - xf) + h10 * xf;
      const h1 = h01 * (1 - xf) + h11 * xf;
      
      return h0 * (1 - yf) + h1 * yf;
    };
    
    // Gradient at position
    const getGradient = (x, y) => {
      const h = getHeightInterpolated(x, y);
      const hx = getHeightInterpolated(x + 1, y);
      const hy = getHeightInterpolated(x, y + 1);
      return { x: h - hx, y: h - hy };
    };
    
    // Run hydraulic erosion simulation
    console.log(`Simulating ${iterations} water droplets...`);
    let lastLog = 0;
    
    for (let iter = 0; iter < iterations; iter++) {
      // Random starting position
      let posX = Math.random() * (resolution - 2) + 1;
      let posY = Math.random() * (resolution - 2) + 1;
      
      let dirX = 0;
      let dirY = 0;
      let velocity = 1;
      let water = 1;
      let sediment = 0;
      
      // Simulate droplet path
      for (let step = 0; step < maxSteps; step++) {
        const oldPosX = posX;
        const oldPosY = posY;
        
        // Calculate gradient
        const gradient = getGradient(posX, posY);
        
        // Update direction with inertia
        dirX = dirX * inertia - gradient.x * (1 - inertia);
        dirY = dirY * inertia - gradient.y * (1 - inertia);
        
        // Normalize direction
        const len = Math.sqrt(dirX * dirX + dirY * dirY);
        if (len !== 0) {
          dirX /= len;
          dirY /= len;
        } else {
          // Random direction on flat terrain
          const angle = Math.random() * Math.PI * 2;
          dirX = Math.cos(angle);
          dirY = Math.sin(angle);
        }
        
        // Move droplet
        posX += dirX;
        posY += dirY;
        
        // Stop if out of bounds
        if (posX < 1 || posX >= resolution - 2 || posY < 1 || posY >= resolution - 2) {
          break;
        }
        
        // Height difference
        const newHeight = getHeightInterpolated(posX, posY);
        const oldHeight = getHeightInterpolated(oldPosX, oldPosY);
        const heightDiff = newHeight - oldHeight;
        
        // Sediment capacity
        const capacity = Math.max(-heightDiff, 0.01) * velocity * water * sedimentCapacity;
        
        // Erode or deposit in radius around position
        const depositAmount = heightDiff > 0 ? Math.min(heightDiff, sediment) : 
                              sediment > capacity ? (sediment - capacity) * depositionRate : 0;
        
        const erodeAmount = heightDiff < 0 && sediment < capacity ? 
                           Math.min((capacity - sediment) * erosionRate, -heightDiff) : 0;
        
        // Apply erosion/deposition in radius
        const xi = Math.floor(posX);
        const yi = Math.floor(posY);
        
        for (let dy = -erosionRadius; dy <= erosionRadius; dy++) {
          for (let dx = -erosionRadius; dx <= erosionRadius; dx++) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > erosionRadius) continue;
            
            const weight = 1 - dist / erosionRadius;
            const x = xi + dx;
            const y = yi + dy;
            
            if (depositAmount > 0) {
              setHeight(x, y, getHeight(x, y) + depositAmount * weight);
              sediment -= depositAmount * weight;
            } else if (erodeAmount > 0) {
              const delta = Math.min(erodeAmount * weight, getHeight(x, y));
              setHeight(x, y, getHeight(x, y) - delta);
              sediment += delta;
            }
          }
        }
        
        // Update droplet properties
        velocity = Math.sqrt(Math.max(0, velocity * velocity + heightDiff));
        water *= (1 - evaporationRate);
      }
      
      // Log progress every 1000 droplets
      if (iter - lastLog >= 1000) {
        console.log(`  Droplet ${iter}/${iterations} (${((iter/iterations)*100).toFixed(1)}%)`);
        lastLog = iter;
      }
    }

    const endTime = performance.now();
    
    // Calculate final statistics and differences
    let finalMin = Infinity;
    let finalMax = -Infinity;
    let finalSum = 0;
    let totalDiff = 0;
    let maxDiff = 0;
    let changedPixels = 0;
    
    for (let i = 0; i < heightMap.length; i++) {
      const val = heightMap[i];
      finalMin = Math.min(finalMin, val);
      finalMax = Math.max(finalMax, val);
      finalSum += val;
      
      const diff = Math.abs(val - originalHeight[i]);
      totalDiff += diff;
      maxDiff = Math.max(maxDiff, diff);
      if (diff > 0.001) changedPixels++;
    }
    
    const finalAvg = finalSum / heightMap.length;
    const avgDiff = totalDiff / heightMap.length;
    
    console.log(`Hydraulic erosion complete in ${((endTime - startTime)/1000).toFixed(2)}s`);
    console.log('Erosion statistics:');
    console.log(`  Before: min=${initialMin.toFixed(4)}, max=${initialMax.toFixed(4)}, avg=${initialAvg.toFixed(4)}`);
    console.log(`  After:  min=${finalMin.toFixed(4)}, max=${finalMax.toFixed(4)}, avg=${finalAvg.toFixed(4)}`);
    console.log(`  Changes: avgDiff=${avgDiff.toFixed(6)}, maxDiff=${maxDiff.toFixed(6)}`);
    console.log(`  ${changedPixels} pixels (${(changedPixels/heightMap.length*100).toFixed(1)}%) changed by >0.001`);

    return { output: heightMap };
  }
}
