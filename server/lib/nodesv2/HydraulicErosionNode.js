import { BaseNode } from '../nodes/BaseNode.js';

/**
 * Hydraulic Erosion Node - LOD 0 (128×128)
 * GPU particle-based erosion simulation with moisture awareness
 */
export class HydraulicErosionNode extends BaseNode {
  static inputs = ['elevation', 'moisture'];
  static outputs = ['erodedElevation'];
  static defaultParams = {
    resolution: 128,
    iterations: 10,
    particlesPerIteration: 10000,
    erosionRate: 0.3,
    depositionRate: 0.3,
    evaporationRate: 0.95,
    minSlope: 0.01,
    maxSteps: 100
  };

  async process(inputs, params) {
    const resolution = params.resolution || 128;
    const seed = params.seed || Date.now();
    const iterations = params.iterations || 10;
    const particlesPerIteration = params.particlesPerIteration || 10000;

    console.log(`🌊 Starting erosion: ${iterations} iterations, ${particlesPerIteration} particles each`);

    // Convert elevation to fixed-point integers for atomic operations
    const elevationData = inputs.elevation;
    const elevationFixed = new Int32Array(elevationData.length);
    const FIXED_SCALE = 1000000; // 6 decimal places precision
    
    for (let i = 0; i < elevationData.length; i++) {
      elevationFixed[i] = Math.floor(elevationData[i] * FIXED_SCALE);
    }

    // Create buffers
    const elevationSize = resolution * resolution * 4;
    const elevationBuffer = this.device.createBuffer({
      size: elevationSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(elevationBuffer, 0, elevationFixed.buffer);

    const moistureBuffer = this.device.createBuffer({
      size: elevationSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(moistureBuffer, 0, inputs.moisture.buffer);

    const shaderCode = `
      struct Params {
        resolution: u32,
        seed: u32,
        iteration: u32,
        erosionRate: f32,
        depositionRate: f32,
        evaporationRate: f32,
        minSlope: f32,
        maxSteps: u32,
        fixedScale: f32,
      }

      @group(0) @binding(0) var<storage, read_write> heightmap: array<atomic<i32>>;
      @group(0) @binding(1) var<storage, read> moisture: array<f32>;
      @group(0) @binding(2) var<uniform> params: Params;

      // Random number generator
      fn hash(n: u32) -> f32 {
        var state = n * 747796405u + 2891336453u;
        state = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
        state = (state >> 22u) ^ state;
        return f32(state) / 4294967295.0;
      }

      fn randomFloat(seed: u32, index: u32) -> f32 {
        return hash(seed + index * 12345u);
      }

      // Get height at position (with bounds checking)
      fn getHeight(x: i32, y: i32) -> f32 {
        if (x < 0 || x >= i32(params.resolution) || y < 0 || y >= i32(params.resolution)) {
          return 1000000.0; // Out of bounds = very high
        }
        let idx = u32(y * i32(params.resolution) + x);
        let heightFixed = atomicLoad(&heightmap[idx]);
        return f32(heightFixed) / params.fixedScale;
      }

      // Calculate gradient at position
      fn calculateGradient(x: i32, y: i32) -> vec2<f32> {
        let center = getHeight(x, y);
        let north = getHeight(x, y - 1);
        let south = getHeight(x, y + 1);
        let west = getHeight(x - 1, y);
        let east = getHeight(x + 1, y);
        
        return vec2<f32>(
          (west - east) * 0.5,
          (north - south) * 0.5
        );
      }

      @compute @workgroup_size(256)
      fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let particleId = global_id.x;
        
        // Unique seed for this particle in this iteration
        let particleSeed = params.seed + particleId * 12345u + params.iteration * 67890u;
        
        // Random start position
        var pos = vec2<f32>(
          randomFloat(particleSeed, 0u) * f32(params.resolution),
          randomFloat(particleSeed, 1u) * f32(params.resolution)
        );
        
        var velocity = vec2<f32>(0.0, 0.0);
        var sediment = 0.0;
        var water = 1.0;
        
        // Simulate droplet
        for (var step = 0u; step < params.maxSteps; step++) {
          let x = i32(pos.x);
          let y = i32(pos.y);
          
          // Bounds check
          if (x < 0 || x >= i32(params.resolution) || y < 0 || y >= i32(params.resolution)) {
            break;
          }
          
          let idx = u32(y * i32(params.resolution) + x);
          
          // Get local moisture (affects erosion strength)
          let localMoisture = moisture[idx];
          
          // Calculate gradient (downhill direction)
          let gradient = calculateGradient(x, y);
          let slope = length(gradient);
          
          // Update velocity (flow downhill)
          velocity = velocity * 0.9 + gradient * 0.1;
          let speed = length(velocity);
          
          // Move particle
          pos += velocity;
          
          // Erosion (scaled by moisture and speed)
          if (slope > params.minSlope) {
            let erosionAmount = params.erosionRate * speed * localMoisture;
            let erosionFixed = i32(erosionAmount * params.fixedScale);
            
            // Atomically subtract from heightmap
            if (erosionFixed > 0) {
              atomicSub(&heightmap[idx], erosionFixed);
              sediment += erosionAmount;
            }
          }
          
          // Deposition (when slowing down)
          if (speed < 0.1 && sediment > 0.01) {
            let depositAmount = sediment * params.depositionRate;
            let depositFixed = i32(depositAmount * params.fixedScale);
            
            // Atomically add to heightmap
            if (depositFixed > 0) {
              atomicAdd(&heightmap[idx], depositFixed);
              sediment -= depositAmount;
            }
          }
          
          // Evaporation
          water *= params.evaporationRate;
          if (water < 0.01) {
            break;
          }
        }
      }
    `;

    // Create compute pipeline
    const shaderModule = this.device.createShaderModule({ code: shaderCode });
    const pipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main'
      }
    });

    // Run erosion iterations
    for (let iter = 0; iter < iterations; iter++) {
      const uniformBuffer = this.createUniformBuffer({
        resolution,
        seed: seed % 1000000,
        iteration: iter,
        erosionRate: params.erosionRate,
        depositionRate: params.depositionRate,
        evaporationRate: params.evaporationRate,
        minSlope: params.minSlope,
        maxSteps: params.maxSteps,
        fixedScale: FIXED_SCALE
      });

      const bindGroup = this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: elevationBuffer } },
          { binding: 1, resource: { buffer: moistureBuffer } },
          { binding: 2, resource: { buffer: uniformBuffer } }
        ]
      });

      const commandEncoder = this.device.createCommandEncoder();
      const passEncoder = commandEncoder.beginComputePass();
      passEncoder.setPipeline(pipeline);
      passEncoder.setBindGroup(0, bindGroup);
      
      const workgroups = Math.ceil(particlesPerIteration / 256);
      passEncoder.dispatchWorkgroups(workgroups);
      passEncoder.end();
      
      this.device.queue.submit([commandEncoder.finish()]);
      await this.device.queue.onSubmittedWorkDone();
      
      uniformBuffer.destroy();
      
      console.log(`   ⚡ Iteration ${iter + 1}/${iterations} complete`);
    }

    // Read back results and convert from fixed-point
    const resultFixed = new Int32Array(resolution * resolution);
    const stagingBuffer = this.device.createBuffer({
      size: elevationSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    
    const commandEncoder = this.device.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(elevationBuffer, 0, stagingBuffer, 0, elevationSize);
    this.device.queue.submit([commandEncoder.finish()]);
    
    await stagingBuffer.mapAsync(GPUMapMode.READ);
    resultFixed.set(new Int32Array(stagingBuffer.getMappedRange()));
    stagingBuffer.unmap();
    
    // Convert back to float
    const erodedElevation = new Float32Array(resultFixed.length);
    for (let i = 0; i < resultFixed.length; i++) {
      erodedElevation[i] = resultFixed[i] / FIXED_SCALE;
      // Clamp to valid range
      erodedElevation[i] = Math.max(0, Math.min(1, erodedElevation[i]));
    }

    // Cleanup
    elevationBuffer.destroy();
    moistureBuffer.destroy();
    stagingBuffer.destroy();

    console.log(`✅ Hydraulic erosion complete (${iterations} iterations)`);
    return { erodedElevation };
  }
}
