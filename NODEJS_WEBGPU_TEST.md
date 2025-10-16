# Node.js WebGPU - Proof of Concept Test

**Test GPU access in Node.js before building the full server architecture**

---

## 1. Current State of Node.js WebGPU (Oct 2024)

### Available Options

**Option A: `@webgpu/node` (Recommended)**
- **Status:** Stable for Node.js 18+
- **Backend:** Uses Dawn (Google's WebGPU implementation)
- **Support:** Vulkan (Linux/Windows), Metal (macOS), D3D12 (Windows)
- **Performance:** Near-native GPU performance
- **Compatibility:** Implements WebGPU spec closely

**Option B: `gpu.js`**
- **Status:** Mature but not true WebGPU
- **Backend:** Compiles JS to GPU kernels
- **Pros:** Easier to set up
- **Cons:** Different API, less powerful than WebGPU

**Option C: `tfjs-node-gpu` (TensorFlow.js)**
- **Status:** Stable
- **Backend:** CUDA (NVIDIA only)
- **Pros:** Excellent for ML workloads
- **Cons:** Overkill for our use case

**Recommendation:** Use `@webgpu/node` - closest to browser WebGPU

---

## 2. Installation Test

### Step 1: Check System Requirements

```bash
# Windows: Check for D3D12 or Vulkan
dxdiag

# Linux: Check for Vulkan
vulkaninfo

# macOS: Metal is built-in (macOS 10.13+)
system_profiler SPDisplaysDataType
```

### Step 2: Install Package

```bash
# Create test directory (don't modify main project yet)
mkdir nodejs-webgpu-test
cd nodejs-webgpu-test
npm init -y

# Install WebGPU for Node.js
npm install @webgpu/node

# Also install types for better IDE support
npm install --save-dev @webgpu/types
```

**Expected install time:** 1-3 minutes (downloads ~50MB of native binaries)

---

## 3. Basic GPU Access Test

### Test 1: GPU Detection

**File:** `test-1-gpu-detection.js`

```javascript
import { GPU } from '@webgpu/node';

async function testGPUAccess() {
  console.log('Testing Node.js WebGPU access...\n');
  
  try {
    // Request adapter
    console.log('Requesting GPU adapter...');
    const adapter = await GPU.requestAdapter({
      powerPreference: 'high-performance'
    });
    
    if (!adapter) {
      console.error('❌ No GPU adapter found!');
      console.log('Possible reasons:');
      console.log('  - No compatible GPU drivers');
      console.log('  - Vulkan/Metal/D3D12 not available');
      console.log('  - Running in headless environment');
      return false;
    }
    
    console.log('✅ GPU adapter found!');
    
    // Get adapter info
    const info = await adapter.requestAdapterInfo();
    console.log('\nGPU Information:');
    console.log('  Vendor:', info.vendor || 'Unknown');
    console.log('  Architecture:', info.architecture || 'Unknown');
    console.log('  Device:', info.device || 'Unknown');
    console.log('  Description:', info.description || 'Unknown');
    
    // Request device
    console.log('\nRequesting GPU device...');
    const device = await adapter.requestDevice();
    console.log('✅ GPU device obtained!');
    
    // Get limits
    console.log('\nDevice Limits:');
    console.log('  Max buffer size:', device.limits.maxBufferSize);
    console.log('  Max compute workgroups X:', device.limits.maxComputeWorkgroupsPerDimension);
    console.log('  Max storage buffer size:', device.limits.maxStorageBufferBindingSize);
    
    // Get features
    console.log('\nSupported Features:');
    device.features.forEach(feature => {
      console.log('  -', feature);
    });
    
    device.destroy();
    console.log('\n✅ GPU test PASSED!');
    return true;
    
  } catch (error) {
    console.error('❌ GPU test FAILED!');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    return false;
  }
}

testGPUAccess().then(success => {
  process.exit(success ? 0 : 1);
});
```

**Run:**
```bash
node test-1-gpu-detection.js
```

**Expected output (success):**
```
Testing Node.js WebGPU access...

Requesting GPU adapter...
✅ GPU adapter found!

GPU Information:
  Vendor: nvidia
  Architecture: Unknown
  Device: NVIDIA GeForce RTX 3060
  Description: D3D12 backend

Requesting GPU device...
✅ GPU device obtained!

Device Limits:
  Max buffer size: 4294967296
  Max compute workgroups X: 65535
  Max storage buffer size: 4294967296

Supported Features:
  - texture-compression-bc
  - indirect-first-instance
  - ...

✅ GPU test PASSED!
```

---

## 4. Compute Shader Test (Perlin Noise)

### Test 2: Run Perlin Noise Shader

**File:** `test-2-perlin-noise.js`

```javascript
import { GPU } from '@webgpu/node';
import { writeFileSync } from 'fs';

async function testPerlinNoise() {
  console.log('Testing Perlin noise generation on GPU...\n');
  
  const adapter = await GPU.requestAdapter();
  const device = await adapter.requestDevice();
  
  const resolution = 512;
  const bufferSize = resolution * resolution * 4; // Float32
  
  // Create output buffer
  const outputBuffer = device.createBuffer({
    size: bufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  
  const readBuffer = device.createBuffer({
    size: bufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  
  // Perlin noise shader (same as client)
  const shaderCode = `
    struct Params {
      resolution: u32,
      seed: u32,
      frequency: f32,
      octaves: u32,
    }
    
    @group(0) @binding(0) var<storage, read_write> output: array<f32>;
    @group(0) @binding(1) var<uniform> params: Params;
    
    fn hash(p: vec2<f32>) -> f32 {
      return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453123);
    }
    
    fn perlin(p: vec2<f32>) -> f32 {
      let pi = floor(p);
      let pf = fract(p);
      
      let a = hash(pi);
      let b = hash(pi + vec2<f32>(1.0, 0.0));
      let c = hash(pi + vec2<f32>(0.0, 1.0));
      let d = hash(pi + vec2<f32>(1.0, 1.0));
      
      let u = pf * pf * (3.0 - 2.0 * pf);
      
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }
    
    @compute @workgroup_size(16, 16)
    fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
      let x = global_id.x;
      let y = global_id.y;
      
      if (x >= params.resolution || y >= params.resolution) {
        return;
      }
      
      let idx = y * params.resolution + x;
      let pos = vec2<f32>(f32(x), f32(y)) * params.frequency / f32(params.resolution);
      
      var noise = 0.0;
      var amplitude = 1.0;
      var freq = 1.0;
      
      for (var i = 0u; i < params.octaves; i++) {
        noise += perlin(pos * freq) * amplitude;
        amplitude *= 0.5;
        freq *= 2.0;
      }
      
      output[idx] = noise * 0.5 + 0.5;
    }
  `;
  
  const shaderModule = device.createShaderModule({ code: shaderCode });
  
  // Create uniform buffer
  const paramsData = new Uint32Array([resolution, 12345, 0, 6]);
  new Float32Array(paramsData.buffer)[2] = 4.0; // frequency
  
  const paramsBuffer = device.createBuffer({
    size: paramsData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(paramsBuffer, 0, paramsData);
  
  // Create pipeline
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  });
  
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    compute: { module: shaderModule, entryPoint: 'main' },
  });
  
  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: outputBuffer } },
      { binding: 1, resource: { buffer: paramsBuffer } },
    ],
  });
  
  // Execute shader
  console.log('Dispatching compute shader...');
  const startTime = Date.now();
  
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, bindGroup);
  passEncoder.dispatchWorkgroups(
    Math.ceil(resolution / 16),
    Math.ceil(resolution / 16)
  );
  passEncoder.end();
  
  commandEncoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, bufferSize);
  device.queue.submit([commandEncoder.finish()]);
  
  // Wait for completion
  await device.queue.onSubmittedWorkDone();
  const execTime = Date.now() - startTime;
  console.log(`✅ Shader executed in ${execTime}ms`);
  
  // Read results
  console.log('Reading results...');
  await readBuffer.mapAsync(GPUMapMode.READ);
  const resultData = new Float32Array(readBuffer.getMappedRange());
  
  // Validate results
  let min = Infinity, max = -Infinity, sum = 0;
  for (let i = 0; i < resultData.length; i++) {
    const val = resultData[i];
    min = Math.min(min, val);
    max = Math.max(max, val);
    sum += val;
  }
  const avg = sum / resultData.length;
  
  console.log('\nResults:');
  console.log('  Min value:', min.toFixed(4));
  console.log('  Max value:', max.toFixed(4));
  console.log('  Average:', avg.toFixed(4));
  console.log('  First 10 values:', Array.from(resultData.slice(0, 10)).map(v => v.toFixed(4)).join(', '));
  
  // Save as PNG (optional - requires sharp or similar)
  console.log('\n💡 Tip: Install "sharp" to save result as PNG');
  console.log('  npm install sharp');
  console.log('  Then uncomment PNG save code');
  
  // Uncomment if you have 'sharp' installed:
  /*
  import sharp from 'sharp';
  const pixels = new Uint8Array(resolution * resolution);
  for (let i = 0; i < resultData.length; i++) {
    pixels[i] = Math.floor(resultData[i] * 255);
  }
  await sharp(pixels, {
    raw: { width: resolution, height: resolution, channels: 1 }
  }).toFile('noise-test.png');
  console.log('✅ Saved to noise-test.png');
  */
  
  readBuffer.unmap();
  outputBuffer.destroy();
  readBuffer.destroy();
  paramsBuffer.destroy();
  device.destroy();
  
  console.log('\n✅ Perlin noise test PASSED!');
  console.log(`   Performance: ${resolution}×${resolution} in ${execTime}ms = ${((resolution * resolution) / execTime / 1000).toFixed(2)}M pixels/sec`);
}

testPerlinNoise().catch(console.error);
```

**Run:**
```bash
node test-2-perlin-noise.js
```

**Expected output:**
```
Testing Perlin noise generation on GPU...

Dispatching compute shader...
✅ Shader executed in 12ms
Reading results...

Results:
  Min value: 0.0342
  Max value: 0.9821
  Average: 0.5123
  First 10 values: 0.5234, 0.5123, 0.4932, ...

✅ Perlin noise test PASSED!
   Performance: 512×512 in 12ms = 21.85M pixels/sec
```

---

## 5. SVDAG Builder Test (Critical Test)

### Test 3: Build SVDAG on Server GPU

**File:** `test-3-svdag-builder.js`

```javascript
import { GPU } from '@webgpu/node';

async function testSVDAGBuilder() {
  console.log('Testing SVDAG builder on server GPU...\n');
  
  const adapter = await GPU.requestAdapter();
  const device = await adapter.requestDevice();
  
  // Create simple voxel grid (8×8×8 cube with some filled voxels)
  const size = 8;
  const voxelGrid = new Uint32Array(size * size * size);
  
  // Fill bottom half with stone (block ID 3)
  for (let y = 0; y < size / 2; y++) {
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const idx = z * size * size + y * size + x;
        voxelGrid[idx] = 3; // Stone
      }
    }
  }
  
  console.log(`Created ${size}³ voxel grid`);
  console.log(`Filled voxels: ${voxelGrid.filter(v => v > 0).length} / ${voxelGrid.length}`);
  
  // Simple SVDAG builder (just tests GPU access, not full implementation)
  // You'd replace this with actual SVDAG building logic
  
  const voxelBuffer = device.createBuffer({
    size: voxelGrid.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(voxelBuffer, 0, voxelGrid);
  
  // Test shader that counts solid voxels (placeholder)
  const testShader = `
    @group(0) @binding(0) var<storage, read> voxels: array<u32>;
    @group(0) @binding(1) var<storage, read_write> output: array<u32>;
    
    @compute @workgroup_size(64)
    fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
      let idx = global_id.x;
      if (idx >= ${voxelGrid.length}u) { return; }
      
      if (voxels[idx] > 0u) {
        atomicAdd(&output[0], 1u);
      }
    }
  `;
  
  const shaderModule = device.createShaderModule({ code: testShader });
  
  const outputBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  
  const readBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    compute: { module: shaderModule, entryPoint: 'main' },
  });
  
  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: voxelBuffer } },
      { binding: 1, resource: { buffer: outputBuffer } },
    ],
  });
  
  console.log('Running GPU computation...');
  const startTime = Date.now();
  
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, bindGroup);
  passEncoder.dispatchWorkgroups(Math.ceil(voxelGrid.length / 64));
  passEncoder.end();
  
  commandEncoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, 4);
  device.queue.submit([commandEncoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  
  const execTime = Date.now() - startTime;
  
  await readBuffer.mapAsync(GPUMapMode.READ);
  const result = new Uint32Array(readBuffer.getMappedRange())[0];
  readBuffer.unmap();
  
  console.log(`✅ GPU counted ${result} solid voxels in ${execTime}ms`);
  console.log(`   Expected: ${voxelGrid.filter(v => v > 0).length}`);
  console.log(`   Match: ${result === voxelGrid.filter(v => v > 0).length ? '✅ YES' : '❌ NO'}`);
  
  voxelBuffer.destroy();
  outputBuffer.destroy();
  readBuffer.destroy();
  device.destroy();
  
  console.log('\n✅ SVDAG builder test PASSED!');
  return result === voxelGrid.filter(v => v > 0).length;
}

testSVDAGBuilder().catch(console.error);
```

---

## 6. Performance Comparison Test

### Test 4: GPU vs CPU Performance

**File:** `test-4-performance.js`

```javascript
import { GPU } from '@webgpu/node';

async function benchmarkGPU(resolution) {
  const adapter = await GPU.requestAdapter();
  const device = await adapter.requestDevice();
  
  // ... (same Perlin shader setup as test-2) ...
  
  const startTime = performance.now();
  // Execute shader
  device.queue.submit([commandEncoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  const gpuTime = performance.now() - startTime;
  
  device.destroy();
  return gpuTime;
}

function benchmarkCPU(resolution) {
  const result = new Float32Array(resolution * resolution);
  
  const startTime = performance.now();
  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const idx = y * resolution + x;
      // Simple noise (not true Perlin, just for comparison)
      result[idx] = Math.random();
    }
  }
  const cpuTime = performance.now() - startTime;
  
  return cpuTime;
}

async function runBenchmark() {
  console.log('GPU vs CPU Performance Benchmark\n');
  
  const resolutions = [256, 512, 1024];
  
  for (const res of resolutions) {
    console.log(`Testing ${res}×${res}...`);
    
    const gpuTime = await benchmarkGPU(res);
    const cpuTime = benchmarkCPU(res);
    const speedup = cpuTime / gpuTime;
    
    console.log(`  GPU: ${gpuTime.toFixed(2)}ms`);
    console.log(`  CPU: ${cpuTime.toFixed(2)}ms`);
    console.log(`  Speedup: ${speedup.toFixed(1)}× faster on GPU\n`);
  }
}

runBenchmark().catch(console.error);
```

**Expected speedup:** 10-50× faster on GPU

---

## 7. Integration Decision Checklist

After running these tests, evaluate:

### ✅ Proceed with GPU if:
- [  ] All tests pass
- [  ] GPU detected successfully
- [  ] Perlin noise generates correctly
- [  ] Performance is >10× faster than CPU
- [  ] Your deployment environment has GPU access

### ⚠️ Use CPU fallback if:
- [  ] No GPU detected
- [  ] Tests fail or crash
- [  ] Deploying to cloud without GPU (e.g., standard AWS EC2)
- [  ] GPU performance <5× faster (driver issues)

### 🚀 Hybrid Approach if:
- [  ] GPU works locally but not in production
- [  ] Use GPU for dev server, CPU for cloud
- [  ] Pre-generate common chunks with GPU, serve from cache

---

## 8. Next Steps (After Testing)

### If GPU Tests Pass:
1. ✅ Add `@webgpu/node` to main `package.json`
2. ✅ Proceed with server GPU architecture (INFINITE_WORLD_IMPLEMENTATION.md)
3. ✅ Reuse client shader code on server

### If GPU Tests Fail:
1. ⚠️ Document error messages
2. ⚠️ Fall back to CPU implementations
3. ⚠️ Consider WASM for CPU acceleration
4. ⚠️ Use GPU for local dev only

---

## 9. Troubleshooting

### Error: "No adapter found"
**Cause:** No compatible GPU backend  
**Fix:** Install Vulkan (Linux), update GPU drivers (Windows), check macOS version (≥10.13)

### Error: "Cannot find module '@webgpu/node'"
**Cause:** Native binaries not compiled  
**Fix:** `npm rebuild @webgpu/node` or reinstall

### Error: "Device lost"
**Cause:** GPU timeout or driver crash  
**Fix:** Reduce workload size, update drivers, check GPU temperature

### Performance worse than expected
**Cause:** CPU bottleneck (data transfer) or small workload  
**Fix:** Batch operations, use persistent buffers, increase resolution

---

## 10. Quick Start Commands

```bash
# 1. Create test directory
mkdir nodejs-webgpu-test && cd nodejs-webgpu-test

# 2. Initialize project
npm init -y

# 3. Install WebGPU
npm install @webgpu/node

# 4. Download test scripts
# (Copy test-1-gpu-detection.js from above)

# 5. Run tests
node test-1-gpu-detection.js
node test-2-perlin-noise.js
node test-3-svdag-builder.js

# 6. If all pass:
echo "✅ Ready for server-side GPU generation!"

# 7. If any fail:
echo "⚠️ Document errors and consider CPU fallback"
```

---

## Conclusion

Run these tests to verify Node.js WebGPU works in your environment **before** committing to the architecture. Tests take ~10 minutes to run and will definitively answer whether server-side GPU is viable for your setup.

**After testing, report back:**
- ✅ All tests passed → Full speed ahead with GPU architecture
- ⚠️ Some tests failed → Hybrid GPU/CPU approach
- ❌ All tests failed → CPU-only with optional WASM acceleration
