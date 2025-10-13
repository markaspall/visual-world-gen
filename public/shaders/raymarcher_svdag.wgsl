// ============================================================================
// Minimal SVDAG Raymarcher - Bare Essentials Only
// ============================================================================

struct Camera {
  position: vec3<f32>,
  fov: f32,
  forward: vec3<f32>,
  aspect: f32,
  right: vec3<f32>,
  _pad1: f32,
  up: vec3<f32>,
  _pad2: f32,
}

struct SVDAGParams {
  root_index: u32,
  max_depth: u32,
  leaf_size: f32,
  node_count: u32,
  world_size: f32,
  _pad1: f32,
  _pad2: f32,
  _pad3: f32,
}

struct BlockMaterial {
  colorR: f32,
  colorG: f32,
  colorB: f32,
  transparent: f32,
  emissive: f32,
  reflective: f32,
  _pad1: f32,
  _pad2: f32,
}

struct Hit {
  normal: vec3<f32>,
  block_id: u32,
  distance: f32,
  transparent_distance: f32,  // Distance where we first hit transparent block (0 if none)
}

struct StackEntry {
  packed_idx_depth: u32,  // 4 bytes - node_idx(16 bits) | depth(8 bits) | unused(8 bits)
  pos_xyz: vec3<f32>,     // 12 bytes - full precision position
}
// Total: 16 bytes (was 20 bytes = 20% reduction)
// Compromise: Smaller than 20, precise enough for AABB math

fn packIdxDepth(node_idx: u32, depth: u32) -> u32 {
  return (node_idx & 0xFFFFu) | ((depth & 0xFFu) << 16u);
}

fn unpackNodeIdx(packed: u32) -> u32 {
  return packed & 0xFFFFu;  // Lower 16 bits
}

fn unpackDepth(packed: u32) -> u32 {
  return (packed >> 16u) & 0xFFu;  // Next 8 bits
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> svdag_params: SVDAGParams;
@group(0) @binding(2) var<storage, read> svdag_nodes: array<u32>;
@group(0) @binding(3) var<storage, read> svdag_leaves: array<u32>;
@group(0) @binding(4) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(5) var<storage, read> materials: array<BlockMaterial>;

const MAX_STACK_DEPTH = 19;  // 16 bytes per entry = 304 bytes (increased for water transparency)
const MAX_STEPS = 128;  // Reduced from 256 - most rays hit in <50 steps

// ============================================================================
// PERFORMANCE TOGGLES - Change these to test what impacts FPS
// ============================================================================
const ENABLE_WATER_TRANSPARENCY = true;  // false = water is OPAQUE (faster)
const ENABLE_TERRAIN_REFLECTIONS = false; // false = sky reflections only (much faster)

// ============================================================================
// Material System
// ============================================================================

fn getMaterial(block_id: u32) -> BlockMaterial {
  if (block_id == 0u || block_id >= arrayLength(&materials)) {
    // Default material (shouldn't happen)
    var mat: BlockMaterial;
    mat.colorR = 0.5;
    mat.colorG = 0.5;
    mat.colorB = 0.5;
    mat.transparent = 0.0;
    mat.emissive = 0.0;
    mat.reflective = 0.0;
    return mat;
  }
  return materials[block_id];
}

// ============================================================================
// Lighting & Atmosphere
// ============================================================================

const PI = 3.14159265359;

fn getSunDirection() -> vec3<f32> {
  // Simple fixed sun direction for now
  return normalize(vec3<f32>(0.5, 1.0, 0.3));
}

fn getSkyColor(rayDir: vec3<f32>, sunDir: vec3<f32>) -> vec3<f32> {
  let sunDot = max(dot(rayDir, sunDir), 0.0);
  let horizonDot = abs(rayDir.y);
  
  // Sky gradient
  let skyColor = mix(
    vec3<f32>(0.5, 0.7, 1.0),  // Horizon (lighter blue)
    vec3<f32>(0.1, 0.3, 0.8),  // Zenith (darker blue)
    pow(horizonDot, 0.5)
  );
  
  // Sun glow
  let sunGlow = pow(sunDot, 32.0) * 0.5;
  
  return skyColor + vec3<f32>(sunGlow);
}

fn fresnelSchlick(cosTheta: f32, n1: f32, n2: f32) -> f32 {
  var r0 = (n1 - n2) / (n1 + n2);
  r0 = r0 * r0;
  let oneMinusCos = 1.0 - cosTheta;
  return r0 + (1.0 - r0) * pow(oneMinusCos, 5.0);
}

// ============================================================================
// AABB Intersection
// ============================================================================

fn intersectAABB(ray_origin: vec3<f32>, ray_dir: vec3<f32>, box_min: vec3<f32>, box_max: vec3<f32>) -> vec2<f32> {
  // Prevent division by zero when ray is parallel to axis
  let eps = 1e-8;
  let safe_dir = vec3<f32>(
    select(ray_dir.x, eps, abs(ray_dir.x) < eps),
    select(ray_dir.y, eps, abs(ray_dir.y) < eps),
    select(ray_dir.z, eps, abs(ray_dir.z) < eps)
  );
  let inv_dir = 1.0 / safe_dir;
  let t0 = (box_min - ray_origin) * inv_dir;
  let t1 = (box_max - ray_origin) * inv_dir;
  
  let tmin_vec = min(t0, t1);
  let tmax_vec = max(t0, t1);
  
  let tmin = max(max(tmin_vec.x, tmin_vec.y), tmin_vec.z);
  let tmax = min(min(tmax_vec.x, tmax_vec.y), tmax_vec.z);
  
  return vec2<f32>(tmin, tmax);
}

// ============================================================================
// SVDAG Navigation
// ============================================================================

fn getOctant(pos: vec3<f32>, parent_center: vec3<f32>) -> u32 {
  var octant = 0u;
  if (pos.x >= parent_center.x) { octant |= 1u; }
  if (pos.y >= parent_center.y) { octant |= 2u; }
  if (pos.z >= parent_center.z) { octant |= 4u; }
  return octant;
}

fn getChildCenter(parent_center: vec3<f32>, child_size: f32, octant: u32) -> vec3<f32> {
  let offset = child_size * 0.5;
  
  // Branchless: use select() for GPU efficiency
  let x = parent_center.x + select(-offset, offset, (octant & 1u) != 0u);
  let y = parent_center.y + select(-offset, offset, (octant & 2u) != 0u);
  let z = parent_center.z + select(-offset, offset, (octant & 4u) != 0u);
  
  return vec3<f32>(x, y, z);
}

fn readNodeTag(node_idx: u32) -> u32 {
  if (node_idx >= arrayLength(&svdag_nodes)) { return 0u; }
  return svdag_nodes[node_idx];
}

fn readChildMask(node_idx: u32) -> u32 {
  if (node_idx + 1u >= arrayLength(&svdag_nodes)) { return 0u; }
  return svdag_nodes[node_idx + 1u];
}

fn readChildIndex(node_idx: u32, octant: u32, child_mask: u32) -> u32 {
  // Count set bits before this octant using bitwise magic (faster than loop)
  let mask_before = child_mask & ((1u << octant) - 1u);
  let offset = countOneBits(mask_before);
  
  if (node_idx + 2u + offset >= arrayLength(&svdag_nodes)) { return 0u; }
  return svdag_nodes[node_idx + 2u + offset];
}

// ============================================================================
// SVDAG Raymarching
// ============================================================================

fn raymarchSVDAG(ray_origin: vec3<f32>, ray_dir: vec3<f32>) -> Hit {
  var hit: Hit;
  hit.block_id = 0u;
  hit.distance = 1e30;
  hit.normal = vec3<f32>(0.0, 1.0, 0.0);
  hit.transparent_distance = 0.0;  // Track first transparent block
  
  // Prevent division by zero when ray is parallel to axis
  let eps = 1e-8;
  let safe_ray_dir = vec3<f32>(
    select(ray_dir.x, eps, abs(ray_dir.x) < eps),
    select(ray_dir.y, eps, abs(ray_dir.y) < eps),
    select(ray_dir.z, eps, abs(ray_dir.z) < eps)
  );
  let inv_ray_dir = 1.0 / safe_ray_dir;
  
  let world_half = svdag_params.world_size * 0.5;
  let world_center = vec3<f32>(world_half);
  let world_min = vec3<f32>(0.0);
  let world_max = vec3<f32>(svdag_params.world_size);
  
  let root_hit = intersectAABB(ray_origin, ray_dir, world_min, world_max);
  if (root_hit.x > root_hit.y || root_hit.y < 0.0) {
    return hit;
  }
  
  let t_start = max(root_hit.x, 0.0);
  var current_t = t_start;
  
  var stack: array<StackEntry, MAX_STACK_DEPTH>;
  var stack_ptr = 0;
  
  // Initialize root node
  stack[0].packed_idx_depth = packIdxDepth(svdag_params.root_index, 0u);
  stack[0].pos_xyz = world_center;
  
  for (var step = 0; step < MAX_STEPS && stack_ptr >= 0; step++) {
    let entry = stack[stack_ptr];
    stack_ptr -= 1;
    
    // Unpack entry
    let node_idx = unpackNodeIdx(entry.packed_idx_depth);
    let node_depth = unpackDepth(entry.packed_idx_depth);
    let node_center = entry.pos_xyz;
    let node_size = svdag_params.world_size / f32(1u << node_depth);  // Derive size from depth
    
    // Recalculate t_entry from AABB
    let node_half = node_size * 0.5;
    let node_min = node_center - vec3<f32>(node_half);
    let node_max = node_center + vec3<f32>(node_half);
    let t0_calc = (node_min - ray_origin) * inv_ray_dir;
    let t1_calc = (node_max - ray_origin) * inv_ray_dir;
    let tmin_calc = min(t0_calc, t1_calc);
    current_t = max(max(max(tmin_calc.x, tmin_calc.y), tmin_calc.z), 0.0);
    
    if (node_idx >= svdag_params.node_count) {
      continue;
    }
    
    let tag = readNodeTag(node_idx);
    
    // Leaf node - we hit geometry
    if (tag == 1u) {
      if (node_idx + 1u >= arrayLength(&svdag_nodes)) {
        continue;
      }
      let leaf_idx = svdag_nodes[node_idx + 1u];
      
      var block_id = 0u;
      if (leaf_idx < arrayLength(&svdag_leaves)) {
        block_id = svdag_leaves[leaf_idx];
      } else {
        block_id = 1u;
      }
      
      if (block_id == 0u) {
        block_id = 1u;
      }
      
      // Check if this block is transparent - if transparency enabled, SKIP it and continue
      if (ENABLE_WATER_TRANSPARENCY && block_id > 0u && block_id < arrayLength(&materials)) {
        let mat = materials[block_id];
        if (mat.transparent > 0.5) {
          // Transparent block - remember first transparent hit
          if (hit.transparent_distance == 0.0) {
            hit.transparent_distance = current_t;
          }
          // Skip it and keep searching for solid terrain
          current_t += node_size * 0.5; // Move past this voxel
          continue;
        }
      }
      
      // SOLID block found - return it
      hit.block_id = block_id;
      hit.distance = current_t;
      
      // Calculate normal from AABB entry face
      let node_min = node_center - vec3<f32>(node_size * 0.5);
      let node_max = node_center + vec3<f32>(node_size * 0.5);
      
      let t0 = (node_min - ray_origin) * inv_ray_dir;
      let t1 = (node_max - ray_origin) * inv_ray_dir;
      let t_near = min(t0, t1);
      let t_entry = max(max(t_near.x, t_near.y), t_near.z);
      
      let epsilon = 0.001;
      if (abs(t_entry - t_near.x) < epsilon) {
        hit.normal = vec3<f32>(-sign(ray_dir.x), 0.0, 0.0);
      } else if (abs(t_entry - t_near.y) < epsilon) {
        hit.normal = vec3<f32>(0.0, -sign(ray_dir.y), 0.0);
      } else {
        hit.normal = vec3<f32>(0.0, 0.0, -sign(ray_dir.z));
      }
      
      return hit;
    }
    
    // Interior node - traverse children
    if (tag == 0u) {
      let child_mask = readChildMask(node_idx);
      
      if (child_mask == 0u) {
        continue;
      }
      
      let child_size = node_size * 0.5;
      let child_half = child_size * 0.5;  // Pre-compute once for all children
      
      let ray_sign_x = u32(ray_dir.x >= 0.0);
      let ray_sign_y = u32(ray_dir.y >= 0.0);
      let ray_sign_z = u32(ray_dir.z >= 0.0);
      
      for (var i = 0u; i < 8u; i++) {
        let octant = i ^ (ray_sign_x | (ray_sign_y << 1u) | (ray_sign_z << 2u));
        
        if ((child_mask & (1u << octant)) == 0u) {
          continue;
        }
        
        let child_idx = readChildIndex(node_idx, octant, child_mask);
        
        if (child_idx == 0u || child_idx >= svdag_params.node_count) {
          continue;
        }
        
        let child_center = getChildCenter(node_center, child_size, octant);
        let child_min = child_center - vec3<f32>(child_half);
        let child_max = child_center + vec3<f32>(child_half);
        
        let t0 = (child_min - ray_origin) * inv_ray_dir;
        let t1 = (child_max - ray_origin) * inv_ray_dir;
        let tmin_vec = min(t0, t1);
        let tmax_vec = max(t0, t1);
        let child_tmin = max(max(tmin_vec.x, tmin_vec.y), tmin_vec.z);
        let child_tmax = min(min(tmax_vec.x, tmax_vec.y), tmax_vec.z);
        
        if (child_tmin <= child_tmax && child_tmax >= current_t) {
          if (stack_ptr + 1 < MAX_STACK_DEPTH) {
            stack_ptr += 1;
            stack[stack_ptr].packed_idx_depth = packIdxDepth(child_idx, node_depth + 1u);
            stack[stack_ptr].pos_xyz = child_center;
          }
        }
      }
    }
  }
  
  return hit;
}

// ============================================================================
// Main Shader
// ============================================================================

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texSize = textureDimensions(outputTexture);
  let pixelCoord = global_id.xy;
  
  if (pixelCoord.x >= texSize.x || pixelCoord.y >= texSize.y) {
    return;
  }
  
  // Generate ray
  let uv = (vec2<f32>(pixelCoord) + vec2<f32>(0.5)) / vec2<f32>(texSize);
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, -(uv.y * 2.0 - 1.0));
  
  let rayDir = normalize(
    camera.forward +
    camera.right * ndc.x * tan(camera.fov * 0.5) * camera.aspect +
    camera.up * ndc.y * tan(camera.fov * 0.5)
  );
  
  // Raymarch - now automatically skips transparent blocks
  let hit = raymarchSVDAG(camera.position, rayDir);
  
  // Get sun direction
  let sunDir = getSunDirection();
  
  // Default to sky color
  var color = getSkyColor(rayDir, sunDir);
  
  if (hit.block_id > 0u) {
    let material = getMaterial(hit.block_id);
    let baseColor = vec3<f32>(material.colorR, material.colorG, material.colorB);
    
    // Directional lighting
    let diffuse = max(dot(hit.normal, sunDir), 0.0);
    let ambient = 0.4;
    let lighting = ambient + diffuse * 0.6;
    
    var finalColor = baseColor * lighting;
    
    // If we passed through transparent blocks (water), apply water effects
    if (ENABLE_WATER_TRANSPARENCY && hit.transparent_distance > 0.0) {
      // WATER RENDERING - smooth surface with terrain beneath
      
      // Calculate Fresnel effect (determines reflection vs transmission)
      let waterNormal = vec3<f32>(0.0, 1.0, 0.0);
      let viewDir = -rayDir;
      let cosTheta = abs(dot(viewDir, waterNormal));
      let fresnel = fresnelSchlick(cosTheta, 1.0, 1.33); // Air to water IOR
      
      // REFRACTION PATH (what you see THROUGH the water)
      // Apply blue water tint to terrain beneath
      let waterColor = vec3<f32>(0.12, 0.56, 1.0);
      let waterDepth = hit.distance - hit.transparent_distance;
      let depthFactor = waterDepth * 0.05; // Attenuation based on depth
      let waterTint = clamp(depthFactor, 0.1, 0.6); // 10-60% tint
      let refractionColor = mix(finalColor, waterColor, waterTint);
      
      // REFLECTION PATH (what bounces off water surface)
      let reflectDir = reflect(rayDir, waterNormal);
      
      var reflectionColor = getSkyColor(reflectDir, sunDir); // Sky reflection (always)
      
      if (ENABLE_TERRAIN_REFLECTIONS) {
        // Sparse sampling: Only trace on 1-in-9 pixels (3x3 grid = 89% cost reduction!)
        let shouldTraceReflection = ((pixelCoord.x % 3u) == 0u) && ((pixelCoord.y % 3u) == 0u);
        
        if (shouldTraceReflection && fresnel > 0.4) { // Only trace if reflection is significant
          let waterSurfacePos = camera.position + rayDir * hit.transparent_distance;
          let reflectionHit = raymarchSVDAG(waterSurfacePos + reflectDir * 0.1, reflectDir);
          
          if (reflectionHit.block_id > 0u) {
            let reflectMat = getMaterial(reflectionHit.block_id);
            let reflectBase = vec3<f32>(reflectMat.colorR, reflectMat.colorG, reflectMat.colorB);
            let reflectDiffuse = max(dot(reflectionHit.normal, sunDir), 0.0);
            let reflectLighting = ambient + reflectDiffuse * 0.6;
            // Mix terrain reflection with sky (helps blend sparse samples)
            reflectionColor = mix(reflectionColor, reflectBase * reflectLighting, 0.7);
          }
        }
      }
      
      // Fresnel determines: STEEP angle (looking down) = refraction, GRAZING angle = reflection
      color = mix(refractionColor, reflectionColor, fresnel);
    } else {
      // Solid terrain (or water transparency disabled)
      color = finalColor;
    }
  }
  
  textureStore(outputTexture, pixelCoord, vec4<f32>(color, 1.0));
}