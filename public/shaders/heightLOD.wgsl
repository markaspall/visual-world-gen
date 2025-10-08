struct Params {
  inputResolution: u32,
  outputResolution: u32,
  poolSize: u32,
  padding: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputHeightMap: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputHeightMap: array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let outX = global_id.x;
  let outY = global_id.y;
  
  if (outX >= params.outputResolution || outY >= params.outputResolution) {
    return;
  }
  
  // Calculate input region to sample (poolSize × poolSize)
  let inX = outX * params.poolSize;
  let inY = outY * params.poolSize;
  
  // Find maximum height in the pool region
  var maxHeight = 0.0;
  
  for (var dy = 0u; dy < params.poolSize; dy++) {
    for (var dx = 0u; dx < params.poolSize; dx++) {
      let sampleX = inX + dx;
      let sampleY = inY + dy;
      
      if (sampleX < params.inputResolution && sampleY < params.inputResolution) {
        let idx = sampleY * params.inputResolution + sampleX;
        let height = inputHeightMap[idx];
        maxHeight = max(maxHeight, height);
      }
    }
  }
  
  // Write result
  let outIdx = outY * params.outputResolution + outX;
  outputHeightMap[outIdx] = maxHeight;
}
