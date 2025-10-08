struct Params {
  resolution: u32,
  padding: u32,
  padding2: u32,
  padding3: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> heightMap: array<f32>;
@group(0) @binding(2) var<storage, read_write> gradientMagnitude: array<f32>;
@group(0) @binding(3) var<storage, read_write> gradientDirection: array<f32>;

fn getHeight(x: i32, y: i32) -> f32 {
  let res = i32(params.resolution);
  let cx = clamp(x, 0, res - 1);
  let cy = clamp(y, 0, res - 1);
  return heightMap[cy * res + cx];
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let x = i32(global_id.x);
  let y = i32(global_id.y);
  let res = i32(params.resolution);
  
  if (x >= res || y >= res) {
    return;
  }
  
  let idx = y * res + x;
  
  // Sobel operator for gradient calculation
  // Gx (horizontal gradient)
  let gx = (
    -1.0 * getHeight(x - 1, y - 1) +
    -2.0 * getHeight(x - 1, y) +
    -1.0 * getHeight(x - 1, y + 1) +
     1.0 * getHeight(x + 1, y - 1) +
     2.0 * getHeight(x + 1, y) +
     1.0 * getHeight(x + 1, y + 1)
  );
  
  // Gy (vertical gradient)
  let gy = (
    -1.0 * getHeight(x - 1, y - 1) +
    -2.0 * getHeight(x, y - 1) +
    -1.0 * getHeight(x + 1, y - 1) +
     1.0 * getHeight(x - 1, y + 1) +
     2.0 * getHeight(x, y + 1) +
     1.0 * getHeight(x + 1, y + 1)
  );
  
  // Gradient magnitude (slope steepness)
  let magnitude = sqrt(gx * gx + gy * gy);
  gradientMagnitude[idx] = magnitude;
  
  // Gradient direction (slope direction in radians, 0-2π)
  let direction = atan2(gy, gx);
  gradientDirection[idx] = direction;
}
