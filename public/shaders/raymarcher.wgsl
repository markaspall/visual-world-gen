struct Camera {
  position: vec3<f32>,
  fov: f32,
  forward: vec3<f32>,
  _pad1: f32,
  right: vec3<f32>,
  _pad2: f32,
  up: vec3<f32>,
  _pad3: f32,
}

struct Params {
  lod0Res: u32,
  lod1Res: u32,
  lod2Res: u32,
  lod3Res: u32,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read> heightLOD0: array<f32>;
@group(0) @binding(3) var<storage, read> heightLOD1: array<f32>;
@group(0) @binding(4) var<storage, read> heightLOD2: array<f32>;
@group(0) @binding(5) var<storage, read> heightLOD3: array<f32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

// Fullscreen quad vertices
@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var output: VertexOutput;
  
  // Generate fullscreen quad
  let x = f32((vertexIndex & 1u) << 1u) - 1.0;
  let y = f32((vertexIndex & 2u)) - 1.0;
  
  output.position = vec4<f32>(x, -y, 0.0, 1.0);
  output.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
  
  return output;
}

// Sample height map
fn sampleHeight(worldPos: vec2<f32>) -> f32 {
  let res = f32(params.lod0Res);
  let mapPos = worldPos / 512.0; // World is 512m x 512m
  
  if (mapPos.x < 0.0 || mapPos.x > 1.0 || mapPos.y < 0.0 || mapPos.y > 1.0) {
    return 0.0; // Out of bounds
  }
  
  let texCoord = mapPos * res;
  let ix = u32(clamp(texCoord.x, 0.0, res - 1.0));
  let iy = u32(clamp(texCoord.y, 0.0, res - 1.0));
  let idx = iy * params.lod0Res + ix;
  
  return heightLOD0[idx] * 200.0; // Scale to 200m max height
}

// Ray march
fn raymarch(rayOrigin: vec3<f32>, rayDir: vec3<f32>) -> vec3<f32> {
  var t = 0.0;
  let maxDist = 1000.0;
  let maxSteps = 256;
  
  for (var i = 0; i < maxSteps; i++) {
    let p = rayOrigin + rayDir * t;
    
    // Sample height at current position
    let terrainHeight = sampleHeight(p.xz);
    
    // Check if ray is below terrain
    if (p.y <= terrainHeight) {
      // Hit! Return terrain color based on height
      let heightNorm = terrainHeight / 200.0;
      
      // Simple height-based coloring
      var color = vec3<f32>(0.0);
      
      if (heightNorm < 0.3) {
        // Low = sand/beach
        color = vec3<f32>(0.93, 0.79, 0.69);
      } else if (heightNorm < 0.5) {
        // Medium = grass
        color = vec3<f32>(0.27, 0.71, 0.27);
      } else if (heightNorm < 0.7) {
        // High = stone
        color = vec3<f32>(0.5, 0.5, 0.5);
      } else {
        // Very high = snow
        color = vec3<f32>(1.0, 1.0, 1.0);
      }
      
      // Apply distance fog
      let fogStart = 100.0;
      let fogEnd = 500.0;
      let fogFactor = clamp((t - fogStart) / (fogEnd - fogStart), 0.0, 1.0);
      let fogColor = vec3<f32>(0.7, 0.8, 0.9);
      
      return mix(color, fogColor, fogFactor);
    }
    
    // Step forward
    let stepSize = max(abs(p.y - terrainHeight), 1.0);
    t += stepSize;
    
    if (t > maxDist) {
      break;
    }
  }
  
  // Missed terrain, return sky color
  let skyColor = vec3<f32>(0.5, 0.7, 1.0);
  return skyColor;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  // Generate ray from camera through pixel
  let ndc = input.uv * 2.0 - 1.0;
  let aspect = 16.0 / 9.0; // TODO: Get from canvas
  
  let rayDir = normalize(
    camera.forward +
    camera.right * ndc.x * tan(camera.fov * 0.5) * aspect +
    camera.up * ndc.y * tan(camera.fov * 0.5)
  );
  
  // Ray march
  let color = raymarch(camera.position, rayDir);
  
  return vec4<f32>(color, 1.0);
}
