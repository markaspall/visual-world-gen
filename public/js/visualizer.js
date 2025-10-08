/**
 * Visualizer - Handles all canvas rendering and data visualization
 */
export class Visualizer {
  constructor(previewCanvas, outputCanvas) {
    this.previewCanvas = previewCanvas;
    this.outputCanvas = outputCanvas;
    
    this.previewCtx = previewCanvas.getContext('2d', { willReadFrequently: true });
    this.outputCtx = outputCanvas.getContext('2d', { willReadFrequently: true });
    
    this.colormap = 'grayscale';
    this.colormaps = {
      grayscale: this.grayscaleColormap.bind(this),
      terrain: this.terrainColormap.bind(this),
      heat: this.heatColormap.bind(this),
      biome: this.biomeColormap.bind(this)
    };
    
    this.setupCanvases();
  }

  setupCanvases() {
    // Set default sizes
    this.resizeCanvas(this.previewCanvas, 512, 512);
    this.resizeCanvas(this.outputCanvas, 1024, 1024);
  }

  resizeCanvas(canvas, width, height) {
    canvas.width = width;
    canvas.height = height;
  }

  setColormap(name) {
    if (this.colormaps[name]) {
      this.colormap = name;
    }
  }

  /**
   * Render data to preview canvas
   */
  renderPreview(data, resolution, stats = null) {
    this.renderToCanvas(this.previewCanvas, this.previewCtx, data, resolution);
    
    // Update stats display
    if (stats) {
      const statsEl = document.getElementById('preview-stats');
      if (statsEl) {
        statsEl.innerHTML = `
          Min: ${stats.min.toFixed(3)}<br>
          Max: ${stats.max.toFixed(3)}<br>
          Mean: ${stats.mean.toFixed(3)}<br>
          Size: ${resolution}x${resolution}
        `;
      }
    }
  }

  /**
   * Render data to output canvas
   */
  renderOutput(data, mapType) {
    // Select appropriate colormap based on map type
    const colormapOverride = {
      'depth': 'grayscale',
      'biome': 'biome',
      'water': 'grayscale',
      'features': 'biome', // Features output is already RGBA colored
      'trails': 'grayscale',
      'blockmap': 'biome' // Block map is already RGBA colored
    };
    
    const prevColormap = this.colormap;
    this.colormap = colormapOverride[mapType] || this.colormap;
    
    this.renderToCanvas(
      this.outputCanvas,
      this.outputCtx,
      data.data,
      data.resolution
    );
    
    this.colormap = prevColormap;
  }

  /**
   * Core rendering function
   */
  renderToCanvas(canvas, ctx, data, resolution) {
    // Resize canvas to match data
    this.resizeCanvas(canvas, resolution, resolution);

    // Create image data
    const imageData = ctx.createImageData(resolution, resolution);
    const pixels = imageData.data;

    // Check if data is already RGBA (Uint8ClampedArray with length = pixels * 4)
    if (data instanceof Uint8ClampedArray && data.length === resolution * resolution * 4) {
      // Direct copy - already in RGBA format (from BiomeClassifier)
      pixels.set(data);
    } else {
      // Apply colormap to Float32Array data
      const colormapFn = this.colormaps[this.colormap];

      for (let i = 0; i < data.length; i++) {
        const value = data[i];
        const color = colormapFn(value);
        
        const pixelIndex = i * 4;
        pixels[pixelIndex] = color.r;
        pixels[pixelIndex + 1] = color.g;
        pixels[pixelIndex + 2] = color.b;
        pixels[pixelIndex + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  /**
   * Calculate statistics for data
   */
  calculateStats(data) {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;

    for (let i = 0; i < data.length; i++) {
      const val = data[i];
      if (val < min) min = val;
      if (val > max) max = val;
      sum += val;
    }

    return {
      min,
      max,
      mean: sum / data.length
    };
  }

  // Colormap functions
  grayscaleColormap(value) {
    const intensity = Math.floor(value * 255);
    return { r: intensity, g: intensity, b: intensity };
  }

  terrainColormap(value) {
    // Terrain colors: deep blue -> shallow blue -> sand -> grass -> rock -> snow
    if (value < 0.2) {
      // Deep water
      const t = value / 0.2;
      return {
        r: Math.floor(10 + t * 20),
        g: Math.floor(20 + t * 40),
        b: Math.floor(60 + t * 80)
      };
    } else if (value < 0.3) {
      // Shallow water
      const t = (value - 0.2) / 0.1;
      return {
        r: Math.floor(30 + t * 50),
        g: Math.floor(60 + t * 80),
        b: Math.floor(140 + t * 60)
      };
    } else if (value < 0.35) {
      // Beach
      const t = (value - 0.3) / 0.05;
      return {
        r: Math.floor(194 + t * 20),
        g: Math.floor(178 + t * 20),
        b: Math.floor(128 + t * 20)
      };
    } else if (value < 0.6) {
      // Grass
      const t = (value - 0.35) / 0.25;
      return {
        r: Math.floor(34 + t * 40),
        g: Math.floor(139 - t * 30),
        b: Math.floor(34 + t * 20)
      };
    } else if (value < 0.8) {
      // Rock
      const t = (value - 0.6) / 0.2;
      return {
        r: Math.floor(100 + t * 20),
        g: Math.floor(100 + t * 10),
        b: Math.floor(80 + t * 10)
      };
    } else {
      // Snow
      const t = (value - 0.8) / 0.2;
      return {
        r: Math.floor(200 + t * 55),
        g: Math.floor(200 + t * 55),
        b: Math.floor(210 + t * 45)
      };
    }
  }

  heatColormap(value) {
    // Heat colors: black -> red -> orange -> yellow -> white
    if (value < 0.25) {
      const t = value / 0.25;
      return {
        r: Math.floor(t * 255),
        g: 0,
        b: 0
      };
    } else if (value < 0.5) {
      const t = (value - 0.25) / 0.25;
      return {
        r: 255,
        g: Math.floor(t * 165),
        b: 0
      };
    } else if (value < 0.75) {
      const t = (value - 0.5) / 0.25;
      return {
        r: 255,
        g: Math.floor(165 + t * 90),
        b: 0
      };
    } else {
      const t = (value - 0.75) / 0.25;
      return {
        r: 255,
        g: 255,
        b: Math.floor(t * 255)
      };
    }
  }

  biomeColormap(value) {
    // Discrete biome colors
    const biomeId = Math.floor(value * 16);
    const biomeColors = [
      { r: 255, g: 220, b: 177 },  // Desert
      { r: 34, g: 139, b: 34 },     // Forest
      { r: 0, g: 100, b: 0 },       // Jungle
      { r: 144, g: 238, b: 144 },   // Grassland
      { r: 176, g: 196, b: 222 },   // Tundra
      { r: 255, g: 250, b: 250 },   // Snow
      { r: 188, g: 143, b: 143 },   // Mountain
      { r: 60, g: 179, b: 113 },    // Swamp
      { r: 210, g: 180, b: 140 },   // Savanna
      { r: 85, g: 107, b: 47 },     // Taiga
      { r: 255, g: 160, b: 122 },   // Mesa
      { r: 70, g: 130, b: 180 },    // Ocean
      { r: 173, g: 216, b: 230 },   // Lake
      { r: 32, g: 178, b: 170 },    // River
      { r: 128, g: 128, b: 128 },   // Rock
      { r: 169, g: 169, b: 169 }    // Barren
    ];
    
    return biomeColors[biomeId % biomeColors.length];
  }

  /**
   * Export canvas to PNG
   */
  async exportToPNG(data, mapType) {
    // Create temporary canvas
    const canvas = document.createElement('canvas');
    canvas.width = data.resolution;
    canvas.height = data.resolution;
    const ctx = canvas.getContext('2d');

    // Select appropriate colormap based on map type
    const colormapOverride = {
      'depth': 'grayscale',
      'biome': 'biome',
      'water': 'grayscale',
      'features': 'biome',
      'trails': 'grayscale',
      'blockmap': 'biome'
    };

    // Render data
    const prevColormap = this.colormap;
    this.colormap = colormapOverride[mapType] || 'grayscale';
    this.renderToCanvas(canvas, ctx, data.data, data.resolution);
    this.colormap = prevColormap;

    // Convert to PNG
    return canvas.toDataURL('image/png');
  }

  /**
   * Pack data into RGBA for PNG export (advanced)
   */
  packRGBA(data, resolution, packing = 'height16') {
    const canvas = document.createElement('canvas');
    canvas.width = resolution;
    canvas.height = resolution;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(resolution, resolution);
    const pixels = imageData.data;

    for (let i = 0; i < data.length; i++) {
      const value = data[i];
      const pixelIndex = i * 4;

      if (packing === 'height16') {
        // Pack 16-bit height into RG channels
        const height = Math.floor(value * 65535);
        pixels[pixelIndex] = (height >> 8) & 0xFF;     // R: high byte
        pixels[pixelIndex + 1] = height & 0xFF;        // G: low byte
        pixels[pixelIndex + 2] = 0;                    // B: unused
        pixels[pixelIndex + 3] = 255;                  // A: opaque
      } else if (packing === 'float32') {
        // Pack 32-bit float into RGBA
        const buffer = new ArrayBuffer(4);
        const floatView = new Float32Array(buffer);
        const byteView = new Uint8Array(buffer);
        floatView[0] = value;
        pixels[pixelIndex] = byteView[0];
        pixels[pixelIndex + 1] = byteView[1];
        pixels[pixelIndex + 2] = byteView[2];
        pixels[pixelIndex + 3] = byteView[3];
      } else {
        // Default: normalized 8-bit in R channel
        pixels[pixelIndex] = Math.floor(value * 255);
        pixels[pixelIndex + 1] = 0;
        pixels[pixelIndex + 2] = 0;
        pixels[pixelIndex + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  }
}
