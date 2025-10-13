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

struct Hit {
  normal: vec3<f32>,
  block_id: u32,
  distance: f32,
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

const MAX_STACK_DEPTH = 24;  // Needs to be large enough to prevent stack overflow holes
const MAX_STEPS = 256;

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
  var center = parent_center;
  
  if ((octant & 1u) != 0u) { center.x += offset; } else { center.x -= offset; }
  if ((octant & 2u) != 0u) { center.y += offset; } else { center.y -= offset; }
  if ((octant & 4u) != 0u) { center.z += offset; } else { center.z -= offset; }
  
  return center;
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
  var offset = 0u;
  for (var i = 0u; i < octant; i++) {
    if ((child_mask & (1u << i)) != 0u) {
      offset += 1u;
    }
  }
  
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
  
  stack[0].node_idx = svdag_params.root_index;
  stack[0].node_pos = world_center;
  stack[0].node_size = svdag_params.world_size;
  stack[0].t_entry = t_start;
  
  for (var step = 0; step < MAX_STEPS && stack_ptr >= 0; step++) {
    let entry = stack[stack_ptr];
    stack_ptr -= 1;
    
    let node_idx = entry.node_idx;
    let node_center = entry.node_pos;
    let node_size = entry.node_size;
    current_t = entry.t_entry;
    
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
      
      if (leaf_idx < arrayLength(&svdag_leaves)) {
        hit.block_id = svdag_leaves[leaf_idx];
      } else {
        hit.block_id = 1u;
      }
      
      if (hit.block_id == 0u) {
        hit.block_id = 1u;
      }
      
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
        let child_half = child_size * 0.5;
        let child_min = child_center - vec3<f32>(child_half);
        let child_max = child_center + vec3<f32>(child_half);
        
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
  
  // Raymarch
  let hit = raymarchSVDAG(camera.position, rayDir);
  
  // Color based on face normal
  var color = vec3<f32>(0.5, 0.7, 1.0); // Sky blue
  
  if (hit.block_id > 0u) {
    // Simple flat color based on which face was hit
    if (abs(hit.normal.y) > 0.5) {
      // Top/bottom faces
      color = vec3<f32>(0.6, 0.8, 0.6); // Light green
    } else if (abs(hit.normal.x) > 0.5) {
      // Left/right faces
      color = vec3<f32>(0.5, 0.7, 0.5); // Medium green
    } else {
      // Front/back faces
      color = vec3<f32>(0.4, 0.6, 0.4); // Dark green
    }
  }
  
  textureStore(outputTexture, pixelCoord, vec4<f32>(color, 1.0));
}