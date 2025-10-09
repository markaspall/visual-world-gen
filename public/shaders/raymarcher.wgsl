struct Camera {
  position: vec3<f32>,
  fov: f32,
  forward: vec3<f32>,
  aspect: f32,
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
@group(0) @binding(3) var outputTexture: texture_storage_2d<rgba8unorm, write>;

// Voxel size in meters
const VOXEL_SIZE = 0.333333;

// Sample height map at voxel center
fn sampleHeightAtVoxel(worldPos: vec3<f32>) -> f32 {
  let res = f32(params.lod0Res);
  let mapPos = worldPos.xz / 512.0; // World is 512m x 512m
  
  if (mapPos.x < 0.0 || mapPos.x > 1.0 || mapPos.y < 0.0 || mapPos.y > 1.0) {
    return 0.0; // Out of bounds
  }
  
  let texCoord = mapPos * res;
  let ix = u32(clamp(texCoord.x, 0.0, res - 1.0));
  let iy = u32(clamp(texCoord.y, 0.0, res - 1.0));
  let idx = iy * params.lod0Res + ix;
  
  return heightLOD0[idx] * 200.0; // Scale to 200m max height
}

// Signed Distance Function for a box
fn sdBox(p: vec3<f32>, b: vec3<f32>) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// Get voxel coordinate from world position (clamped to voxel center)
fn worldToVoxel(worldPos: vec3<f32>) -> vec3<i32> {
  return vec3<i32>(floor(worldPos / VOXEL_SIZE));
}

// Get voxel center from voxel coordinate
fn voxelToWorld(voxelCoord: vec3<i32>) -> vec3<f32> {
  return (vec3<f32>(voxelCoord) + vec3<f32>(0.5)) * VOXEL_SIZE;
}

// Ray march with voxel-based SDF
fn raymarch(rayOrigin: vec3<f32>, rayDir: vec3<f32>) -> vec3<f32> {
  var t = 0.1;
  let maxDist = 1000.0;
  let maxSteps = 512;
  
  for (var i = 0; i < maxSteps; i++) {
    let rayPos = rayOrigin + rayDir * t;
    
    // Get voxel coordinate
    let voxelCoord = worldToVoxel(rayPos);
    let voxelCenter = voxelToWorld(voxelCoord);
    
    // Sample height at voxel center
    let terrainHeight = sampleHeightAtVoxel(voxelCenter);
    
    // Determine if this voxel is solid (below terrain height)
    let voxelBottomY = voxelCenter.y - VOXEL_SIZE * 0.5;
    let voxelTopY = voxelCenter.y + VOXEL_SIZE * 0.5;
    
    if (voxelBottomY <= terrainHeight) {
      // This voxel contains terrain, compute SDF
      let halfSize = vec3<f32>(VOXEL_SIZE * 0.5);
      let localPos = rayPos - voxelCenter;
      let dist = sdBox(localPos, halfSize);
      
      if (dist < 0.001) {
        // Hit! Compute normal by sampling nearby voxels
        let epsilon = VOXEL_SIZE;
        let h0 = sampleHeightAtVoxel(voxelCenter);
        let hx = sampleHeightAtVoxel(voxelCenter + vec3<f32>(epsilon, 0.0, 0.0));
        let hz = sampleHeightAtVoxel(voxelCenter + vec3<f32>(0.0, 0.0, epsilon));
        
        let normal = normalize(vec3<f32>(
          h0 - hx,
          epsilon,
          h0 - hz
        ));
        
        // Determine base color based on height
        let heightNorm = terrainHeight / 200.0;
        
        var baseColor = vec3<f32>(0.0);
        
        if (heightNorm < 0.3) {
          // Low = sand/beach
          baseColor = vec3<f32>(0.93, 0.79, 0.69);
        } else if (heightNorm < 0.5) {
          // Medium = grass
          baseColor = vec3<f32>(0.27, 0.71, 0.27);
        } else if (heightNorm < 0.7) {
          // High = stone
          baseColor = vec3<f32>(0.5, 0.5, 0.5);
        } else {
          // Very high = snow
          baseColor = vec3<f32>(1.0, 1.0, 1.0);
        }
        
        // Simple directional lighting (sun from above-right)
        let sunDir = normalize(vec3<f32>(0.5, 0.8, 0.3));
        let diffuse = max(dot(normal, sunDir), 0.0);
        let ambient = 0.3;
        let lighting = ambient + diffuse * 0.7;
        
        var color = baseColor * lighting;
        
        // Apply distance fog
        let fogStart = 100.0;
        let fogEnd = 500.0;
        let fogFactor = clamp((t - fogStart) / (fogEnd - fogStart), 0.0, 1.0);
        let fogColor = vec3<f32>(0.7, 0.8, 0.9);
        
        return mix(color, fogColor, fogFactor);
      }
      
      // Step by SDF distance (but at least 1 voxel)
      t += max(abs(dist), VOXEL_SIZE);
    } else {
      // Empty voxel, skip it
      t += VOXEL_SIZE;
    }
    
    if (t > maxDist) {
      break;
    }
  }
  
  // Missed terrain, return sky color
  let skyColor = vec3<f32>(0.5, 0.7, 1.0);
  return skyColor;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texSize = textureDimensions(outputTexture);
  let pixelCoord = global_id.xy;
  
  // Bounds check
  if (pixelCoord.x >= texSize.x || pixelCoord.y >= texSize.y) {
    return;
  }
  
  // Generate ray from camera through pixel
  let uv = (vec2<f32>(pixelCoord) + vec2<f32>(0.5)) / vec2<f32>(texSize);
  let ndc = uv * 2.0 - 1.0;
  
  let rayDir = normalize(
    camera.forward +
    camera.right * ndc.x * tan(camera.fov * 0.5) * camera.aspect +
    camera.up * ndc.y * tan(camera.fov * 0.5)
  );
  
  // Ray march
  let color = raymarch(camera.position, rayDir);
  
  // Write to output texture
  textureStore(outputTexture, pixelCoord, vec4<f32>(color, 1.0));
}
