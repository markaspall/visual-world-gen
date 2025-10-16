/**
 * Test Node.js WebGPU Access
 * Run this first to verify GPU is available before building full system
 * Usage: node server/test-gpu.js
 */

import { create, globals } from 'webgpu';

// Setup WebGPU globals (required for node-webgpu)
Object.assign(globalThis, globals);
const navigator = { gpu: create([]) };

async function testGPUAccess() {
  console.log('🔍 Testing Node.js WebGPU access...\n');
  
  try {
    // Request adapter
    console.log('Requesting GPU adapter...');
    const adapter = await navigator.gpu?.requestAdapter({
      powerPreference: 'high-performance'
    });
    
    if (!adapter) {
      console.error('❌ No GPU adapter found!');
      console.log('\n⚠️  Possible causes:');
      console.log('  - No compatible GPU drivers installed');
      console.log('  - Vulkan/Metal/D3D12 not available');
      console.log('  - Running in headless environment without GPU');
      console.log('\n💡 Solution: Use CPU fallback for chunk generation');
      return false;
    }
    
    console.log('✅ GPU adapter found!');
    
    // Request device
    console.log('\n🔧 Requesting GPU device...');
    const device = await adapter.requestDevice();
    console.log('✅ GPU device obtained!');
    
    // Get limits (basic info)
    console.log('\n📏 Device Limits:');
    console.log('  Max buffer size:', (device.limits.maxBufferSize / 1024 / 1024).toFixed(0), 'MB');
    console.log('  Max compute workgroups:', device.limits.maxComputeWorkgroupsPerDimension);
    console.log('  Max storage buffer:', (device.limits.maxStorageBufferBindingSize / 1024 / 1024).toFixed(0), 'MB');
    
    // Test basic compute shader (like the example)
    console.log('\n🧪 Testing compute shader...');
    const shaderModule = device.createShaderModule({
      code: `
        @group(0) @binding(0) var<storage, read_write> output: array<f32>;
        
        @compute @workgroup_size(64)
        fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
          let idx = global_id.x;
          output[idx] = f32(idx) * 2.0;
        }
      `
    });
    
    const buffer = device.createBuffer({
      size: 256 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });
    
    console.log('✅ Shader module created successfully');
    
    device.destroy();
    console.log('\n✅ GPU test PASSED!');
    console.log('🚀 Server-side GPU generation is available!');
    return true;
    
  } catch (error) {
    console.error('\n❌ GPU test FAILED!');
    console.error('Error:', error.message);
    console.log('\n⚠️  Will need to use CPU fallback for chunk generation');
    return false;
  }
}

// Run test
testGPUAccess().then(success => {
  process.exit(success ? 0 : 1);
});
