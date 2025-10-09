import { BaseNode } from './BaseNode.js';

export class SurfaceAnimationNode extends BaseNode {
  static inputs = [];
  static outputs = ['animation'];
  static defaultParams = {
    name: 'Water Ripples',
    type: 'ripples', // ripples, flow, sway, shimmer
    speed: 0.5,
    scale: 0.15,
    strength: 0.08,
    octaves: 3,
    direction: { x: 1.0, y: 0.0 } // For flow patterns
  };

  async process(inputs, params) {
    // This node doesn't need GPU processing - it just defines animation parameters
    // Return animation data that will be used during export
    return {
      animation: {
        name: params.name,
        type: params.type,
        speed: params.speed,
        scale: params.scale,
        strength: params.strength,
        octaves: params.octaves,
        direction: [params.direction.x, params.direction.y]
      }
    };
  }
  
  renderPreview(container) {
    // Create animated preview canvas
    const preview = document.createElement('canvas');
    preview.width = 240;
    preview.height = 120;
    preview.style.cssText = 'width: 100%; border-radius: 4px; background: #000; margin-top: 8px;';
    container.appendChild(preview);
    
    const ctx = preview.getContext('2d');
    let animationFrame = null;
    const startTime = Date.now();
    
    // Simple hash function for noise
    const hash = (x, y) => {
      const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      return h - Math.floor(h);
    };
    
    // Simple 2D noise
    const noise = (x, y) => {
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;
      
      const a = hash(ix, iy);
      const b = hash(ix + 1, iy);
      const c = hash(ix, iy + 1);
      const d = hash(ix + 1, iy + 1);
      
      const ux = fx * fx * (3 - 2 * fx);
      const uy = fy * fy * (3 - 2 * fy);
      
      return a * (1 - ux) * (1 - uy) + 
             b * ux * (1 - uy) + 
             c * (1 - ux) * uy + 
             d * ux * uy;
    };
    
    // Animate preview
    const animate = () => {
      const time = (Date.now() - startTime) / 1000.0 * this.params.speed;
      
      // Clear
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, preview.width, preview.height);
      
      // Draw pattern based on type
      const imageData = ctx.createImageData(preview.width, preview.height);
      
      for (let y = 0; y < preview.height; y++) {
        for (let x = 0; x < preview.width; x++) {
          let value = 0;
          
          if (this.params.type === 'ripples') {
            // Multi-octave noise
            let amplitude = 1.0;
            let frequency = this.params.scale * 0.05;
            
            for (let oct = 0; oct < this.params.octaves; oct++) {
              const nx = x * frequency + time * 0.3 * frequency;
              const ny = y * frequency + time * 0.2 * frequency;
              value += noise(nx, ny) * amplitude;
              frequency *= 2;
              amplitude *= 0.5;
            }
            value = value * this.params.strength * 5;
            
          } else if (this.params.type === 'flow') {
            // Directional flow
            const nx = (x + time * 30 * this.params.direction.x) * this.params.scale * 0.05;
            const ny = (y + time * 30 * this.params.direction.y) * this.params.scale * 0.05;
            value = noise(nx, ny) * this.params.strength * 5;
            
          } else if (this.params.type === 'sway') {
            // Sine wave sway
            const phase = x * this.params.scale * 0.1 + time * this.params.speed * Math.PI;
            value = Math.sin(phase) * this.params.strength * 5;
            
          } else if (this.params.type === 'shimmer') {
            // Fast, subtle variation
            const nx = x * this.params.scale * 0.1;
            const ny = y * this.params.scale * 0.1 + time * 2;
            value = noise(nx, ny) * this.params.strength * 3;
          }
          
          // Map to color (blue gradient for visualization)
          const brightness = Math.floor((value + 1) * 0.5 * 255);
          const idx = (y * preview.width + x) * 4;
          imageData.data[idx] = brightness * 0.2;
          imageData.data[idx + 1] = brightness * 0.5;
          imageData.data[idx + 2] = brightness;
          imageData.data[idx + 3] = 255;
        }
      }
      
      ctx.putImageData(imageData, 0, 0);
      
      // Add text overlay
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.font = '12px monospace';
      ctx.fillText(`${this.params.type} - ${this.params.name}`, 8, preview.height - 8);
      
      animationFrame = requestAnimationFrame(animate);
    };
    
    animate();
    
    // Cleanup on node removal
    const stopAnimation = () => cancelAnimationFrame(animationFrame);
    preview.dataset.stopAnimation = 'true';
    
    return stopAnimation;
  }
}
