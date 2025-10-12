// ============================================================================
// SVDAG-based Voxel Raymarcher for WebGPU
// Sparse Voxel Directed Acyclic Graph traversal for efficient open-world rendering
// ============================================================================

struct Camera {
  position: vec3<f32>,
  fov: f32,
  forward: vec3<f32>,
  aspect: f32,
  right: vec3<f32>,
  _pad2: f32,
  up: vec3<f32>,
  _pad3: f32,
  showTerrain: f32,
  showWater: f32,
  debugWaterValues: f32,
  useLOD: f32,
  debugLODLevels: f32,
  debugStepCount: f32,
  debugDistance: f32,
  debugNormals: f32,
  debugDAGLevels: f32,
  debugLeafSize: f32,
  debugPerformance: f32,
  _pad6: f32,
  enableShadows: f32,
  enableReflections: f32,
  enableFog: f32,
  enableEarlyExit: f32,
  enableWaterAnimation: f32,
  increaseShadowBias: f32,
  showVoxelGrid: f32,
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

struct TimeParams {
  time: f32,
  timeOfDay: f32,
  fogDistance: f32,
  fogDensity: f32,
}

struct BlockMaterial {
  id: f32,
  colorR: f32,
  colorG: f32,
  colorB: f32,
  transparent: f32,
  emissive: f32,
  reflective: f32,
  refractive: f32,
  animationId: f32,
  _pad1: f32,
  _pad2: f32,
  _pad3: f32,
}

struct Animation {
  animType: f32,
  speed: f32,
  scale: f32,
  strength: f32,
  octaves: f32,
  dirX: f32,
  dirY: f32,
  _pad: f32,
}

struct Hit {
  position: vec3<f32>,
  normal: vec3<f32>,
  block_id: u32,
  distance: f32,
  step_count: i32,
  dag_depth: i32,
  found_leaf: u32,  // Debug: did we find any leaf nodes?
  node_size: f32,   // Debug: size of the node we hit (for leaf size visualization)
}

struct StackEntry {
  node_idx: u32,
  node_pos: vec3<f32>,
  node_size: f32,
  t_entry: f32,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> svdag_params: SVDAGParams;
@group(0) @binding(2) var<storage, read> svdag_nodes: array<u32>;
@group(0) @binding(3) var<storage, read> svdag_leaves: array<u32>;
@group(0) @binding(4) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(5) var<storage, read> materials: array<BlockMaterial>;
@group(0) @binding(6) var<uniform> timeParams: TimeParams;
@group(0) @binding(7) var<storage, read> animations: array<Animation>;

const VOXEL_SIZE = 0.333333;
const WORLD_VOXELS = 512.0;
const PI = 3.14159265359;
const MAX_STACK_DEPTH = 12;  // Reduced from 16 (depth 8 needs max 9 levels)
const MAX_STEPS = 256;  // Reduced from 1024 for better performance
const EPSILON = 0.0001;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

fn getSunDirection(timeOfDay: f32) -> vec3<f32> {
  let angle = timeOfDay * 2.0 * PI;
  let elevation = sin(angle);
  let azimuth = cos(angle);
  return normalize(vec3<f32>(azimuth, elevation, 0.3));
}

fn getSkyColor(rayDir: vec3<f32>, sunDir: vec3<f32>) -> vec3<f32> {
  let sunDot = max(dot(rayDir, sunDir), 0.0);
  let horizonDot = abs(rayDir.y);
  let sunElevation = sunDir.y;
  
  let dayColor = vec3<f32>(0.4, 0.7, 1.0);
  let dayHorizon = vec3<f32>(0.7, 0.85, 1.0);
  let daySun = vec3<f32>(1.0, 0.95, 0.8);
  
  let sunsetColor = vec3<f32>(0.4, 0.3, 0.6);
  let sunsetHorizon = vec3<f32>(1.0, 0.5, 0.3);
  let sunsetSun = vec3<f32>(1.0, 0.4, 0.2);
  
  let nightColor = vec3<f32>(0.01, 0.01, 0.05);
  let nightHorizon = vec3<f32>(0.02, 0.02, 0.08);
  let nightSun = vec3<f32>(0.8, 0.8, 0.9);
  
  var skyColor: vec3<f32>;
  var horizonColor: vec3<f32>;
  var sunColor: vec3<f32>;
  
  if (sunElevation > 0.3) {
    skyColor = dayColor;
    horizonColor = dayHorizon;
    sunColor = daySun;
  } else if (sunElevation > -0.1) {
    let t = smoothstep(-0.1, 0.3, sunElevation);
    skyColor = mix(sunsetColor, dayColor, t);
    horizonColor = mix(sunsetHorizon, dayHorizon, t);
    sunColor = mix(sunsetSun, daySun, t);
  } else if (sunElevation > -0.3) {
    let t = smoothstep(-0.3, -0.1, sunElevation);
    skyColor = mix(nightColor, sunsetColor, t);
    horizonColor = mix(nightHorizon, sunsetHorizon, t);
    sunColor = mix(nightSun, sunsetSun, t);
  } else {
    skyColor = nightColor;
    horizonColor = nightHorizon;
    sunColor = nightSun;
  }
  
  var color = mix(horizonColor, skyColor, horizonDot);
  let sunGlow = pow(sunDot, 128.0) * 2.0 + pow(sunDot, 8.0) * 0.5;
  let glowStrength = select(0.3, 1.0, sunElevation > -0.1);
  color += sunColor * sunGlow * glowStrength;
  
  if (sunElevation < 0.0) {
    let starDensity = max(0.0, -sunElevation) * 0.5;
    let starNoise = hash(rayDir.xz * 200.0);
    if (starNoise > 0.998) {
      color += vec3<f32>(1.0, 1.0, 0.9) * starDensity;
    }
  }
  
  return color;
}

fn getFogColor(sunDir: vec3<f32>) -> vec3<f32> {
  let sunElevation = sunDir.y;
  let dayFog = vec3<f32>(0.7, 0.8, 0.9);
  let sunsetFog = vec3<f32>(0.9, 0.6, 0.5);
  let nightFog = vec3<f32>(0.05, 0.05, 0.15);
  
  if (sunElevation > 0.3) {
    return dayFog;
  } else if (sunElevation > -0.1) {
    let t = smoothstep(-0.1, 0.3, sunElevation);
    return mix(sunsetFog, dayFog, t);
  } else if (sunElevation > -0.3) {
    let t = smoothstep(-0.3, -0.1, sunElevation);
    return mix(nightFog, sunsetFog, t);
  } else {
    return nightFog;
  }
}

fn applyFog(color: vec3<f32>, distance: f32, rayDir: vec3<f32>, sunDir: vec3<f32>) -> vec3<f32> {
  let fogStart = 50.0;  // Fog starts at 50m
  let fogEnd = 200.0;   // Full fog at 200m
  
  if (distance < fogStart) {
    return color;  // No fog before 50m
  }
  
  // Exponential fog after fogStart
  let adjustedDistance = distance - fogStart;
  let fogDensity = 0.01;  // Reduced density for better visibility
  let fogFactor = 1.0 - exp(-adjustedDistance * fogDensity);
  let fogColor = getFogColor(sunDir);
  
  return mix(color, fogColor, clamp(fogFactor, 0.0, 1.0));
}

fn hash(p: vec2<f32>) -> f32 {
  let p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.13);
  let dot_p3 = dot(vec3<f32>(p3.x + p3.y, p3.y + p3.z, p3.z + p3.x), p3);
  return fract((dot_p3 + p3.x) * p3.y);
}

fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  
  let a = hash(i);
  let b = hash(i + vec2<f32>(1.0, 0.0));
  let c = hash(i + vec2<f32>(0.0, 1.0));
  let d = hash(i + vec2<f32>(1.0, 1.0));
  
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn waterNoise(pos: vec2<f32>, time: f32) -> f32 {
  var value = 0.0;
  var amplitude = 1.0;
  var frequency = 1.0;
  
  for (var i = 0; i < 3; i++) {
    let p = pos * frequency + vec2<f32>(time * 0.3, time * 0.2) * frequency;
    value += noise(p) * amplitude;
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  
  return value * 2.0 - 1.0;
}

fn getAnimatedNormal(worldPos: vec3<f32>, anim: Animation) -> vec3<f32> {
  let time = timeParams.time * anim.speed;
  let scale = anim.scale;
  let strength = anim.strength;
  let epsilon = 0.5;
  
  var h = 0.0;
  var hx = 0.0;
  var hz = 0.0;
  
  if (anim.animType < 0.5) {
    h = waterNoise(worldPos.xz * scale, time) * strength;
    hx = waterNoise((worldPos.xz + vec2<f32>(epsilon, 0.0)) * scale, time) * strength;
    hz = waterNoise((worldPos.xz + vec2<f32>(0.0, epsilon)) * scale, time) * strength;
  } else if (anim.animType < 1.5) {
    let flowDir = vec2<f32>(anim.dirX, anim.dirY);
    h = noise((worldPos.xz + time * 10.0 * flowDir) * scale) * strength;
    hx = noise((worldPos.xz + vec2<f32>(epsilon, 0.0) + time * 10.0 * flowDir) * scale) * strength;
    hz = noise((worldPos.xz + vec2<f32>(0.0, epsilon) + time * 10.0 * flowDir) * scale) * strength;
  } else if (anim.animType < 2.5) {
    let phase = worldPos.x * scale * 0.5 + time * anim.speed * 3.14159;
    h = sin(phase) * strength;
    hx = sin((worldPos.x + epsilon) * scale * 0.5 + time * anim.speed * 3.14159) * strength;
    hz = h;
  } else {
    h = noise(worldPos.xz * scale + vec2<f32>(time * 2.0)) * strength * 0.5;
    hx = noise((worldPos.xz + vec2<f32>(epsilon, 0.0)) * scale + vec2<f32>(time * 2.0)) * strength * 0.5;
    hz = noise((worldPos.xz + vec2<f32>(0.0, epsilon)) * scale + vec2<f32>(time * 2.0)) * strength * 0.5;
  }
  
  let dx = (hx - h) / epsilon;
  let dz = (hz - h) / epsilon;
  return normalize(vec3<f32>(-dx, 1.0, -dz));
}

fn fresnelSchlick(cosTheta: f32, n1: f32, n2: f32) -> f32 {
  var r0 = (n1 - n2) / (n1 + n2);
  r0 = r0 * r0;
  let oneMinusCos = 1.0 - cosTheta;
  return r0 + (1.0 - r0) * pow(oneMinusCos, 5.0);
}

fn heatmap(value: f32, maxValue: f32) -> vec3<f32> {
  let t = clamp(value / maxValue, 0.0, 1.0);
  
  if (t < 0.25) {
    let s = t * 4.0;
    return vec3<f32>(0.0, s, 1.0);
  } else if (t < 0.5) {
    let s = (t - 0.25) * 4.0;
    return vec3<f32>(0.0, 1.0, 1.0 - s);
  } else if (t < 0.75) {
    let s = (t - 0.5) * 4.0;
    return vec3<f32>(s, 1.0, 0.0);
  } else {
    let s = (t - 0.75) * 4.0;
    return vec3<f32>(1.0, 1.0 - s, 0.0);
  }
}

fn getMaterial(blockId: u32) -> BlockMaterial {
  for (var i = 0u; i < arrayLength(&materials); i++) {
    if (u32(materials[i].id) == blockId) {
      return materials[i];
    }
  }
  
  var defaultMat: BlockMaterial;
  defaultMat.id = f32(blockId);
  defaultMat.colorR = 0.5;
  defaultMat.colorG = 0.5;
  defaultMat.colorB = 0.5;
  defaultMat.transparent = 0.0;
  defaultMat.emissive = 0.0;
  defaultMat.reflective = 0.0;
  defaultMat.refractive = 1.0;
  return defaultMat;
}

// ============================================================================
// SVDAG-SPECIFIC FUNCTIONS
// ============================================================================

fn intersectAABB(ray_origin: vec3<f32>, ray_dir: vec3<f32>, box_min: vec3<f32>, box_max: vec3<f32>) -> vec2<f32> {
  let inv_dir = 1.0 / ray_dir;
  let t0 = (box_min - ray_origin) * inv_dir;
  let t1 = (box_max - ray_origin) * inv_dir;
  
  let tmin_vec = min(t0, t1);
  let tmax_vec = max(t0, t1);
  
  let tmin = max(max(tmin_vec.x, tmin_vec.y), tmin_vec.z);
  let tmax = min(min(tmax_vec.x, tmax_vec.y), tmax_vec.z);
  
  return vec2<f32>(tmin, tmax);
}

fn getOctant(pos: vec3<f32>, parent_center: vec3<f32>) -> u32 {
  var octant = 0u;
  if (pos.x >= parent_center.x) { octant |= 1u; }
  if (pos.y >= parent_center.y) { octant |= 2u; }
  if (pos.z >= parent_center.z) { octant |= 4u; }
  return octant;
}

fn getChildCenter(parent_center: vec3<f32>, child_size: f32, octant: u32) -> vec3<f32> {
  let offset = child_size * 0.5;
  var center = parent_center;
  
  if ((octant & 1u) != 0u) { center.x += offset; } else { center.x -= offset; }
  if ((octant & 2u) != 0u) { center.y += offset; } else { center.y -= offset; }
  if ((octant & 4u) != 0u) { center.z += offset; } else { center.z -= offset; }
  
  return center;
}

fn readNodeTag(node_idx: u32) -> u32 {
  if (node_idx >= arrayLength(&svdag_nodes)) {
    return 0u;
  }
  return svdag_nodes[node_idx];
}

fn readChildMask(node_idx: u32) -> u32 {
  if (node_idx + 1u >= arrayLength(&svdag_nodes)) {
    return 0u;
  }
  return svdag_nodes[node_idx + 1u];
}

fn readChildIndex(node_idx: u32, octant: u32, child_mask: u32) -> u32 {
  var offset = 0u;
  for (var i = 0u; i < octant; i++) {
    if ((child_mask & (1u << i)) != 0u) {
      offset += 1u;
    }
  }
  
  if (node_idx + 2u + offset >= arrayLength(&svdag_nodes)) {
    return 0u;
  }
  return svdag_nodes[node_idx + 2u + offset];
}

fn readLeafBlockID(leaf_idx: u32, local_voxel: vec3<i32>) -> u32 {
  // Bounds check
  if (leaf_idx >= arrayLength(&svdag_leaves)) {
    return 0u;
  }
  
  // Read block ID directly from leaves buffer
  let blockId = svdag_leaves[leaf_idx];
  
  // Safety check: if blockId is 0, something went wrong
  // Return at least 1 (grass) so we can see something
  if (blockId == 0u) {
    return 1u; // Default to grass
  }
  
  return blockId;
}

// ============================================================================
// SVDAG RAY MARCHING
// ============================================================================

fn raymarchSVDAG(ray_origin: vec3<f32>, ray_dir: vec3<f32>) -> Hit {
  var hit: Hit;
  hit.block_id = 0u;
  hit.distance = 1e30;
  hit.step_count = 0;
  hit.dag_depth = 0;
  hit.found_leaf = 0u;
  hit.node_size = 0.0;
  hit.position = vec3<f32>(0.0);
  hit.normal = vec3<f32>(0.0, 1.0, 0.0);
  
  // PRE-COMPUTE inverse ray direction once (MAJOR OPTIMIZATION)
  let inv_ray_dir = 1.0 / ray_dir;
  
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
  
  stack[0].node_idx = svdag_params.root_index;
  stack[0].node_pos = world_center;
  stack[0].node_size = svdag_params.world_size;
  stack[0].t_entry = t_start;
  
  while (stack_ptr >= 0 && hit.step_count < MAX_STEPS) {
    hit.step_count += 1;
    
    let entry = stack[stack_ptr];
    stack_ptr -= 1;
    
    let node_idx = entry.node_idx;
    let node_center = entry.node_pos;
    let node_size = entry.node_size;
    current_t = entry.t_entry;
    
    // DEBUG: Visualize what we're hitting by storing node_size even for misses
    if (hit.node_size == 0.0) {
      hit.node_size = node_size;
    }
    
    // Validate node index
    if (node_idx >= svdag_params.node_count) {
      continue;
    }
    
    let tag = readNodeTag(node_idx);
    
    if (tag == 1u) {
      hit.found_leaf = 1u;
      // This is a leaf node - we hit geometry!
      // Read the leaf index from nodes buffer (stored at node_idx + 1)
      if (node_idx + 1u >= arrayLength(&svdag_nodes)) {
        continue;
      }
      let leaf_idx = svdag_nodes[node_idx + 1u];
      
      // Read block ID directly from leaves buffer
      if (leaf_idx < arrayLength(&svdag_leaves)) {
        hit.block_id = svdag_leaves[leaf_idx];
      } else {
        hit.block_id = 0u;
      }
      
      // DEBUG: If block_id is 0, use a special color to see what's happening
      // This should NOT happen - all leaves should have valid block IDs
      if (hit.block_id == 0u) {
        hit.block_id = 1u; // Temporary: force to grass to see structure
      }
      
      // Fast path: Only check toggles if at least one is disabled
      if (camera.showTerrain < 0.5 || camera.showWater < 0.5) {
        let material = getMaterial(hit.block_id);
        let isWater = material.transparent > 0.5;
        let isEnabled = (isWater && camera.showWater > 0.5) || (!isWater && camera.showTerrain > 0.5);
        
        if (!isEnabled) {
          // Skip this block and continue traversal
          continue;
        }
      }
      
      hit.position = ray_origin + ray_dir * current_t;
      hit.distance = current_t;
      hit.dag_depth = MAX_STACK_DEPTH - stack_ptr;
      hit.node_size = node_size;  // Store leaf size for visualization
      
      // Calculate normal by determining which AABB face the ray entered
      let node_min = node_center - vec3<f32>(node_size * 0.5);
      let node_max = node_center + vec3<f32>(node_size * 0.5);
      
      // Use pre-computed inv_ray_dir for AABB intersection
      let t0 = (node_min - ray_origin) * inv_ray_dir;
      let t1 = (node_max - ray_origin) * inv_ray_dir;
      let t_near = min(t0, t1);
      let t_far = max(t0, t1);
      let t_entry = max(max(t_near.x, t_near.y), t_near.z);
      
      // Determine which component gave us the entry point
      let epsilon = 0.001;
      if (abs(t_entry - t_near.x) < epsilon) {
        hit.normal = vec3<f32>(-sign(ray_dir.x), 0.0, 0.0);
      } else if (abs(t_entry - t_near.y) < epsilon) {
        hit.normal = vec3<f32>(0.0, -sign(ray_dir.y), 0.0);
      } else {
        hit.normal = vec3<f32>(0.0, 0.0, -sign(ray_dir.z));
      }
      
      return hit;
      
    } else if (tag == 0u) {
      let child_mask = readChildMask(node_idx);
      
      if (child_mask == 0u) {
        continue;
      }
      
      let child_size = node_size * 0.5;
      
      // Determine octant traversal order based on ray direction
      // This ensures we process children front-to-back
      let ray_sign_x = u32(ray_dir.x >= 0.0);
      let ray_sign_y = u32(ray_dir.y >= 0.0);
      let ray_sign_z = u32(ray_dir.z >= 0.0);
      
      // Process octants in reverse order based on ray signs
      // This makes closer children get pushed last, popped first
      for (var i = 0u; i < 8u; i++) {
        // Flip octant bits based on ray direction to get front-to-back order
        let octant = i ^ (ray_sign_x | (ray_sign_y << 1u) | (ray_sign_z << 2u));
        
        if ((child_mask & (1u << octant)) == 0u) {
          continue;
        }
        
        let child_idx = readChildIndex(node_idx, octant, child_mask);
        
        // Validate child index (must be > 0 and within bounds)
        if (child_idx == 0u || child_idx >= svdag_params.node_count) {
          continue;
        }
        
        let child_center = getChildCenter(node_center, child_size, octant);
        let child_half = child_size * 0.5;
        let child_min = child_center - vec3<f32>(child_half);
        let child_max = child_center + vec3<f32>(child_half);
        
        // OPTIMIZED: Inline AABB intersection with pre-computed inv_ray_dir
        let t0 = (child_min - ray_origin) * inv_ray_dir;
        let t1 = (child_max - ray_origin) * inv_ray_dir;
        let tmin_vec = min(t0, t1);
        let tmax_vec = max(t0, t1);
        let child_tmin = max(max(tmin_vec.x, tmin_vec.y), tmin_vec.z);
        let child_tmax = min(min(tmax_vec.x, tmax_vec.y), tmax_vec.z);
        
        if (child_tmin <= child_tmax && child_tmax >= current_t) {
          let child_t = max(child_tmin, current_t);
          
          if (stack_ptr + 1 < MAX_STACK_DEPTH) {
            stack_ptr += 1;
            stack[stack_ptr].node_idx = child_idx;
            stack[stack_ptr].node_pos = child_center;
            stack[stack_ptr].node_size = child_size;
            stack[stack_ptr].t_entry = child_t;
          }
        }
      }
    }
  }
  
  return hit;
}

fn softShadowSVDAG(origin: vec3<f32>, lightDir: vec3<f32>) -> f32 {
  let shadow_hit = raymarchSVDAG(origin + lightDir * 0.1, lightDir);
  
  if (shadow_hit.block_id > 0u && shadow_hit.distance < 20.0) {
    let material = getMaterial(shadow_hit.block_id);
    
    // Check if shadow caster should be visible
    let isWater = material.transparent > 0.5;
    let shouldCastShadow = (isWater && camera.showWater > 0.5) || (!isWater && camera.showTerrain > 0.5);
    
    if (shouldCastShadow) {
      let penumbra = smoothstep(0.0, 15.0, shadow_hit.distance);
      return mix(0.85, 1.0, penumbra);
    }
  }
  
  return 1.0;
}

fn traceReflectionSVDAG(ray_origin: vec3<f32>, ray_dir: vec3<f32>) -> vec3<f32> {
  let hit = raymarchSVDAG(ray_origin, ray_dir);
  
  if (hit.block_id > 0u) {
    let material = getMaterial(hit.block_id);
    
    // Check if reflection target should be visible
    let isWater = material.transparent > 0.5;
    let shouldReflect = (isWater && camera.showWater > 0.5) || (!isWater && camera.showTerrain > 0.5);
    
    if (shouldReflect) {
      let baseColor = vec3<f32>(material.colorR, material.colorG, material.colorB);
      
      let sunDir = getSunDirection(timeParams.timeOfDay);
      let diffuse = max(dot(hit.normal, sunDir), 0.0);
      
      let sunElevation = sunDir.y;
      var ambient: f32;
      if (sunElevation > 0.3) {
        ambient = 0.5;
      } else if (sunElevation > -0.1) {
        ambient = mix(0.15, 0.5, smoothstep(-0.1, 0.3, sunElevation));
      } else {
        ambient = mix(0.03, 0.15, smoothstep(-0.3, -0.1, sunElevation));
      }
      
      return baseColor * (ambient + diffuse * (1.0 - ambient));
    }
  }
  
  let sunDir = getSunDirection(timeParams.timeOfDay);
  return getSkyColor(ray_dir, sunDir);
}

// ============================================================================
// MAIN COMPUTE SHADER
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
  
  // Early world bounds check - skip traversal for rays that miss entirely
  let world_min = vec3<f32>(0.0);
  let world_max = vec3<f32>(svdag_params.world_size);
  let inv_dir = 1.0 / rayDir;
  let t0_world = (world_min - camera.position) * inv_dir;
  let t1_world = (world_max - camera.position) * inv_dir;
  let tmin_world = min(t0_world, t1_world);
  let tmax_world = max(t0_world, t1_world);
  let t_near_world = max(max(tmin_world.x, tmin_world.y), tmin_world.z);
  let t_far_world = min(min(tmax_world.x, tmax_world.y), tmax_world.z);
  
  // Fast path: ray misses world entirely - output sky immediately (if enabled)
  if (camera.enableEarlyExit > 0.5 && (t_near_world > t_far_world || t_far_world < 0.0)) {
    let sunDir = getSunDirection(timeParams.timeOfDay);
    let skyColor = getSkyColor(rayDir, sunDir);
    textureStore(outputTexture, pixelCoord, vec4<f32>(skyColor, 1.0));
    return;
  }
  
  // Raymarch SVDAG
  let hit = raymarchSVDAG(camera.position, rayDir);
  
  // PURE PERFORMANCE MODE - Absolute minimum rendering
  // Only traversal, no material lookups, no normal calc (uses default normal)
  if (camera.debugPerformance > 0.5) {
    if (hit.block_id > 0u) {
      // Hit solid geometry - output green
      textureStore(outputTexture, pixelCoord, vec4<f32>(0.0, 1.0, 0.0, 1.0));
    } else {
      // Miss - output blue sky
      textureStore(outputTexture, pixelCoord, vec4<f32>(0.5, 0.7, 1.0, 1.0));
    }
    return;
  }
  
  // Debug modes (work even without valid hits)
  if (camera.debugStepCount > 0.5) {
    if (hit.step_count > 0) {
      let stepColor = heatmap(f32(hit.step_count), 100.0);
      textureStore(outputTexture, pixelCoord, vec4<f32>(stepColor, 1.0));
    } else {
      textureStore(outputTexture, pixelCoord, vec4<f32>(0.0, 0.0, 0.0, 1.0)); // Black = no traversal
    }
    return;
  }
  
  if (camera.debugDAGLevels > 0.5) {
    if (hit.step_count > 0) {
      let depthColor = heatmap(f32(hit.dag_depth), f32(svdag_params.max_depth));
      textureStore(outputTexture, pixelCoord, vec4<f32>(depthColor, 1.0));
    } else {
      textureStore(outputTexture, pixelCoord, vec4<f32>(0.0, 0.0, 0.0, 1.0));
    }
    return;
  }
  
  if (camera.debugDistance > 0.5) {
    if (hit.step_count > 0) {
      let distColor = heatmap(hit.distance, 200.0);
      textureStore(outputTexture, pixelCoord, vec4<f32>(distColor, 1.0));
    } else {
      textureStore(outputTexture, pixelCoord, vec4<f32>(0.0, 0.0, 0.0, 1.0));
    }
    return;
  }
  
  if (camera.debugNormals > 0.5 && hit.step_count > 0) {
    let normalColor = (hit.normal + vec3<f32>(1.0)) * 0.5;
    textureStore(outputTexture, pixelCoord, vec4<f32>(normalColor, 1.0));
    return;
  }
  
  // Leaf size visualization - color code by node size (shows even for misses)
  if (camera.debugLeafSize > 0.5) {
    if (hit.node_size > 0.0) {
      // Map node_size (0.666 to ~100) to heatmap (small=blue, large=red)
      let sizeColor = heatmap(hit.node_size, svdag_params.world_size * 0.1);
      textureStore(outputTexture, pixelCoord, vec4<f32>(sizeColor, 1.0));
    } else {
      textureStore(outputTexture, pixelCoord, vec4<f32>(0.0, 0.0, 0.0, 1.0)); // Black = no traversal
    }
    return;
  }
  
  // Flat color debug mode - FAST pure material colors with simple lighting
  // This is the performance baseline - no shadows, no reflections, no water effects
  if (camera.debugWaterValues > 0.5) {
    if (hit.block_id > 0u) {
      let material = getMaterial(hit.block_id);
      var flatColor = vec3<f32>(material.colorR, material.colorG, material.colorB);
      
      // Simple directional lighting (no shadow rays)
      let sunDir = normalize(vec3<f32>(0.5, 1.0, 0.3));
      let light = max(dot(hit.normal, sunDir), 0.3); // Ambient 0.3
      flatColor = flatColor * light;
      
      textureStore(outputTexture, pixelCoord, vec4<f32>(flatColor, 1.0));
    } else {
      textureStore(outputTexture, pixelCoord, vec4<f32>(0.5, 0.7, 1.0, 1.0)); // Sky blue
    }
    return;
  }
  
  // Default to sky
  let sunDir = getSunDirection(timeParams.timeOfDay);
  var color = getSkyColor(rayDir, sunDir);
  
  // Handle hit
  if (hit.block_id > 0u) {
    
    // Get material
    let material = getMaterial(hit.block_id);
    var baseColor = vec3<f32>(material.colorR, material.colorG, material.colorB);
    
    // Check if water (transparent material)
    if (material.transparent > 0.5) {
      // Water rendering
      if (camera.showWater > 0.5) {
        var waterSurfaceNormal = vec3<f32>(0.0, 1.0, 0.0);
        
        // Apply animation if assigned and enabled
        if (camera.enableWaterAnimation > 0.5 && material.animationId >= 0.0) {
          let animIndex = i32(material.animationId);
          if (animIndex < i32(arrayLength(&animations))) {
            let anim = animations[animIndex];
            waterSurfaceNormal = getAnimatedNormal(hit.position, anim);
          }
        }
        
        // Water rendering with optional reflections
        let waterColor = baseColor * 0.3; // Darken water color
        
        if (camera.enableReflections > 0.5) {
          // Fresnel for water surface
          let viewDir = -rayDir;
          let cosTheta = abs(dot(viewDir, waterSurfaceNormal));
          let fresnel = fresnelSchlick(cosTheta, 1.0, 1.33);
          
          // Trace reflection
          let reflectDir = reflect(rayDir, waterSurfaceNormal);
          let reflectionColor = traceReflectionSVDAG(hit.position + reflectDir * 0.1, reflectDir);
          
          // Blend water color with reflection
          color = mix(waterColor, reflectionColor, fresnel);
        } else {
          // Simple water color without reflections
          color = waterColor;
        }
        
        // Apply fog (toggleable)
        if (camera.enableFog > 0.5) {
          color = applyFog(color, hit.distance, rayDir, sunDir);
        }
      } else {
        // Water disabled, show sky
        color = getSkyColor(rayDir, sunDir);
      }
    } else {
      // Solid terrain rendering
      if (camera.showTerrain > 0.5) {
        // Lighting
        let diffuse = max(dot(hit.normal, sunDir), 0.0);
        
        // Soft shadows (toggleable)
        var shadow = 1.0;
        if (camera.enableShadows > 0.5) {
          // Adjustable shadow bias to fix shadow acne
          let shadowBias = select(0.1, 0.5, camera.increaseShadowBias > 0.5);
          shadow = softShadowSVDAG(hit.position + hit.normal * shadowBias, sunDir);
        }
        
        // Ambient lighting based on time of day
        let sunElevation = sunDir.y;
        var ambient: f32;
        if (sunElevation > 0.3) {
          ambient = 0.55;
        } else if (sunElevation > -0.1) {
          ambient = mix(0.25, 0.55, smoothstep(-0.1, 0.3, sunElevation));
        } else {
          ambient = mix(0.05, 0.25, smoothstep(-0.3, -0.1, sunElevation));
        }
        
        // Sky light for indirect illumination
        let skyLight = 0.2 * (1.0 - max(dot(hit.normal, vec3<f32>(0.0, -1.0, 0.0)), 0.0));
        
        let lighting = min(ambient + skyLight + diffuse * shadow * 0.6, 1.0);
        
        // Apply lighting
        var finalColor = baseColor * lighting;
        
        // Emissive materials
        if (material.emissive > 0.0) {
          finalColor = mix(finalColor, baseColor, material.emissive);
        }
        
        // Show voxel grid lines (debug mode)
        if (camera.showVoxelGrid > 0.5) {
          let gridPos = hit.position % svdag_params.leaf_size;
          let gridThickness = 0.05;
          if (gridPos.x < gridThickness || gridPos.y < gridThickness || gridPos.z < gridThickness ||
              gridPos.x > svdag_params.leaf_size - gridThickness ||
              gridPos.y > svdag_params.leaf_size - gridThickness ||
              gridPos.z > svdag_params.leaf_size - gridThickness) {
            finalColor = vec3<f32>(0.0, 1.0, 0.0); // Green grid lines
          }
        }
        
        // Apply atmospheric fog (toggleable)
        if (camera.enableFog > 0.5) {
          finalColor = applyFog(finalColor, hit.distance, rayDir, sunDir);
        }
        
        color = finalColor;
      } else {
        // Terrain disabled, show sky
        color = getSkyColor(rayDir, sunDir);
      }
    }
  }
  
  // Write output
  textureStore(outputTexture, pixelCoord, vec4<f32>(color, 1.0));
}
