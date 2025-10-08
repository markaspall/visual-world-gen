import { BaseNode } from './BaseNode.js';

export class FeaturesNode extends BaseNode {
  static inputs = ['height', 'water', 'gradient', 'biomes', 'moisture', 'temperature'];
  static outputs = ['features', 'featureMap'];
  static defaultParams = {
    features: [
      { 
        name: 'Waterfall', 
        color: '#00BFFF', 
        enabled: true,
        waterMin: 0.01,
        gradientMin: 0.3,
        maxCount: 50
      },
      { 
        name: 'Mountain Peak', 
        color: '#FFFFFF', 
        enabled: true,
        heightMin: 0.8,
        gradientMax: 0.1,
        isLocalMaxima: true,
        maxCount: 30
      },
      { 
        name: 'Vista Point', 
        color: '#FFD700', 
        enabled: true,
        heightMin: 0.7,
        gradientMax: 0.2,
        maxCount: 20
      },
      { 
        name: 'Lake', 
        color: '#1E90FF', 
        enabled: true,
        waterMin: 0.5,
        gradientMax: 0.05,
        minArea: 100,
        maxCount: 15
      },
      { 
        name: 'River Crossing', 
        color: '#4169E1', 
        enabled: true,
        waterMin: 0.01,
        waterMax: 0.5,
        gradientMax: 0.15,
        maxCount: 40
      }
    ]
  };

  async process(inputs, params) {
    const resolution = params.resolution || 512;
    const heightMap = inputs.height;
    const waterMap = inputs.water || new Float32Array(resolution * resolution).fill(0);
    const gradientMap = inputs.gradient || new Float32Array(resolution * resolution).fill(0);
    const biomesMap = inputs.biomes;
    const moistureMap = inputs.moisture;
    const temperatureMap = inputs.temperature;

    if (!heightMap) {
      throw new Error('FeaturesNode requires height input');
    }

    const featureRules = params.features || FeaturesNode.defaultParams.features;
    const enabledFeatures = featureRules.filter(f => f.enabled);

    console.log('Feature detection:', { resolution, numRules: enabledFeatures.length });

    const startTime = performance.now();
    const detectedFeatures = [];

    // Detect features based on rules
    for (const rule of enabledFeatures) {
      const candidates = this.detectFeatureType(
        rule,
        heightMap,
        waterMap,
        gradientMap,
        resolution
      );
      
      // Limit to maxCount
      const limited = candidates.slice(0, rule.maxCount || 50);
      detectedFeatures.push(...limited.map(f => ({ ...f, type: rule.name, color: rule.color })));
    }

    console.log(`Detected ${detectedFeatures.length} features`);

    // Create visualization map
    const featureMap = this.createFeatureVisualization(detectedFeatures, resolution);

    const endTime = performance.now();
    console.log(`Feature detection complete in ${(endTime - startTime).toFixed(2)}ms`);

    return {
      features: detectedFeatures,
      featureMap: featureMap
    };
  }

  detectFeatureType(rule, heightMap, waterMap, gradientMap, resolution) {
    const candidates = [];

    for (let y = 1; y < resolution - 1; y++) {
      for (let x = 1; x < resolution - 1; x++) {
        const idx = y * resolution + x;
        const height = heightMap[idx];
        const water = waterMap[idx];
        const gradient = gradientMap[idx];

        // Check conditions
        let matches = true;

        if (rule.heightMin !== undefined && height < rule.heightMin) matches = false;
        if (rule.heightMax !== undefined && height > rule.heightMax) matches = false;
        if (rule.waterMin !== undefined && water < rule.waterMin) matches = false;
        if (rule.waterMax !== undefined && water > rule.waterMax) matches = false;
        if (rule.gradientMin !== undefined && gradient < rule.gradientMin) matches = false;
        if (rule.gradientMax !== undefined && gradient > rule.gradientMax) matches = false;

        // Special conditions
        if (rule.isLocalMaxima && matches) {
          matches = this.isLocalMaxima(x, y, heightMap, resolution);
        }

        if (matches) {
          // Calculate score for priority (higher = better feature)
          const score = this.scoreFeature(rule, height, water, gradient);
          candidates.push({ x, y, score, metadata: { height, water, gradient } });
        }
      }
    }

    // Sort by score and return top candidates
    return candidates.sort((a, b) => b.score - a.score);
  }

  isLocalMaxima(x, y, heightMap, resolution) {
    const idx = y * resolution + x;
    const h = heightMap[idx];

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= resolution || ny < 0 || ny >= resolution) continue;
        const nidx = ny * resolution + nx;
        if (heightMap[nidx] > h) return false;
      }
    }
    return true;
  }

  scoreFeature(rule, height, water, gradient) {
    let score = 0;
    
    // Waterfalls: prefer higher drops
    if (rule.name === 'Waterfall') {
      score = gradient * 10 + water * 5;
    }
    // Peaks: prefer higher elevation
    else if (rule.name === 'Mountain Peak') {
      score = height * 10;
    }
    // Vistas: prefer high + not too steep
    else if (rule.name === 'Vista Point') {
      score = height * 8 + (1 - gradient) * 2;
    }
    // Lakes: prefer larger flat water areas
    else if (rule.name === 'Lake') {
      score = water * 10 + (1 - gradient) * 5;
    }
    // River crossings: prefer shallow water on flat areas
    else if (rule.name === 'River Crossing') {
      score = water * 5 + (1 - gradient) * 5;
    }
    
    return score;
  }

  createFeatureVisualization(features, resolution) {
    const colorData = new Uint8ClampedArray(resolution * resolution * 4);
    
    // Transparent background
    for (let i = 0; i < colorData.length; i += 4) {
      colorData[i + 3] = 0; // Alpha = 0
    }

    // Draw features as colored dots (3x3 pixels for visibility)
    for (const feature of features) {
      const rgb = this.hexToRgb(feature.color);
      
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = feature.x + dx;
          const y = feature.y + dy;
          if (x >= 0 && x < resolution && y >= 0 && y < resolution) {
            const idx = (y * resolution + x) * 4;
            colorData[idx] = rgb.r;
            colorData[idx + 1] = rgb.g;
            colorData[idx + 2] = rgb.b;
            colorData[idx + 3] = 255;
          }
        }
      }
    }

    return colorData;
  }

  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  }
}
