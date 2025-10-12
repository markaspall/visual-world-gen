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
  debug_block_id: f32,
  debug_dag_level: f32,
  debug_step_count: f32,
  _pad3: f32,
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
  depth: u32,
  steps: u32,
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

const MAX_STACK_DEPTH = 12;
const MAX_STEPS = 256;

// ============================================================================
// AABB Intersection
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
  hit.depth = 0u;
  hit.steps = 0u;
  
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
  
  for (var step = 0; step < MAX_STEPS && stack_ptr >= 0; step++) {
    hit.steps = u32(step);
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
      // CRITICAL: Ensure we're actually at a leaf (tag == 1)
      // This should always be true here, but check anyway
      // Calculate depth by counting how many times we halved the size
      var depth = 0u;
      var size = svdag_params.world_size;
      while (size > node_size * 1.5 && depth < 20u) {
        size *= 0.5;
        depth += 1u;
      }
      hit.depth = depth;
      
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
      
      // Calculate actual intersection with this leaf's AABB
      let node_min = node_center - vec3<f32>(node_size * 0.5);
      let node_max = node_center + vec3<f32>(node_size * 0.5);
      
      let t0 = (node_min - ray_origin) * inv_ray_dir;
      let t1 = (node_max - ray_origin) * inv_ray_dir;
      let tmin_vec = min(t0, t1);
      let tmax_vec = max(t0, t1);
      let leaf_tmin = max(max(tmin_vec.x, tmin_vec.y), tmin_vec.z);
      let leaf_tmax = min(min(tmax_vec.x, tmax_vec.y), tmax_vec.z);
      
      // If ray starts inside voxel, use current_t (small positive offset)
      // Otherwise use the actual entry point
      var actual_t = leaf_tmin;
      if (leaf_tmin < 0.0) {
        // Ray origin is inside this voxel, use a small offset
        actual_t = 0.001;
      }
      
      hit.distance = actual_t;
      
      // Calculate hit point in world space
      let hit_pos = ray_origin + ray_dir * actual_t;
      
      // Use hit point position to determine which voxel face was hit
      // Convert to voxel-local coordinates centered at node_center
      let local_pos = hit_pos - node_center;
      let half_size = node_size * 0.5;
      
      // Normalize to -0.5 to +0.5 range
      let norm_x = local_pos.x / node_size;
      let norm_y = local_pos.y / node_size;
      let norm_z = local_pos.z / node_size;
      
      // Find which coordinate is closest to ±0.5 (face boundary)
      let dist_to_face_x = abs(abs(norm_x) - 0.5);
      let dist_to_face_y = abs(abs(norm_y) - 0.5);
      let dist_to_face_z = abs(abs(norm_z) - 0.5);
      
      // Closest face determines normal
      if (dist_to_face_y < dist_to_face_x && dist_to_face_y < dist_to_face_z) {
        // Y face (top or bottom)
        if (norm_y > 0.0) {
          hit.normal = vec3<f32>(0.0, 1.0, 0.0);
        } else {
          hit.normal = vec3<f32>(0.0, -1.0, 0.0);
        }
      } else if (dist_to_face_x < dist_to_face_z) {
        // X face (left or right)
        if (norm_x > 0.0) {
          hit.normal = vec3<f32>(1.0, 0.0, 0.0);
        } else {
          hit.normal = vec3<f32>(-1.0, 0.0, 0.0);
        }
      } else {
        // Z face (front or back)
        if (norm_z > 0.0) {
          hit.normal = vec3<f32>(0.0, 0.0, 1.0);
        } else {
          hit.normal = vec3<f32>(0.0, 0.0, -1.0);
        }
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
        // Slightly expand child AABB to ensure no gaps at boundaries
        let expand = 0.001;
        let child_min = child_center - vec3<f32>(child_half + expand);
        let child_max = child_center + vec3<f32>(child_half + expand);
        
        let t0 = (child_min - ray_origin) * inv_ray_dir;
        let t1 = (child_max - ray_origin) * inv_ray_dir;
        let tmin_vec = min(t0, t1);
        let tmax_vec = max(t0, t1);
        let child_tmin = max(max(tmin_vec.x, tmin_vec.y), tmin_vec.z);
        let child_tmax = min(min(tmax_vec.x, tmax_vec.y), tmax_vec.z);
        
        // Add small epsilon for boundary cases to avoid rejecting valid children
        let eps = 0.001;
        if (child_tmin - eps <= child_tmax && child_tmax + eps >= current_t) {
          let child_t = max(child_tmin, current_t - eps);
          
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
  
  // Color based on debug mode or normal rendering
  var color = vec3<f32>(0.5, 0.7, 1.0); // Sky blue
  
  // DEBUG: Block ID visualization
  if (camera.debug_block_id > 0.5) {
    if (hit.block_id > 0u) {
      // Unique color per block ID using hash
      let hue = f32(hit.block_id) * 0.618034; // Golden ratio for color spread
      let sat = 0.8;
      let val = 0.9;
      // Simple HSV to RGB
      let h = fract(hue) * 6.0;
      let x = (1.0 - abs(h % 2.0 - 1.0)) * sat * val;
      let c = sat * val;
      if (h < 1.0) { color = vec3<f32>(c, x, 0.0); }
      else if (h < 2.0) { color = vec3<f32>(x, c, 0.0); }
      else if (h < 3.0) { color = vec3<f32>(0.0, c, x); }
      else if (h < 4.0) { color = vec3<f32>(0.0, x, c); }
      else if (h < 5.0) { color = vec3<f32>(x, 0.0, c); }
      else { color = vec3<f32>(c, 0.0, x); }
      color = mix(vec3<f32>(0.0), color, val);
    }
  }
  // DEBUG: DAG depth visualization WITH BOUNDARIES
  else if (camera.debug_dag_level > 0.5) {
    if (hit.block_id > 0u) {
      // Calculate hit point
      let hit_pos = camera.position + (rayDir * hit.distance);
      
      // Get voxel size at this depth (size of the leaf node that was hit)
      let voxel_size = svdag_params.world_size / pow(2.0, f32(hit.depth));
      
      // Check if near boundary - use actual world distance
      let to_boundary_x = abs(fract(hit_pos.x / voxel_size) - 0.5);
      let to_boundary_y = abs(fract(hit_pos.y / voxel_size) - 0.5);
      let to_boundary_z = abs(fract(hit_pos.z / voxel_size) - 0.5);
      
      // Show very thin lines
      let line_thickness = 0.01; // 1% of voxel size  
      let is_boundary = to_boundary_x > 0.5 - line_thickness || 
                       to_boundary_y > 0.5 - line_thickness || 
                       to_boundary_z > 0.5 - line_thickness;
      
      // Enhanced depth color coding
      // Depth 0-2: Red (large nodes)
      // Depth 3-5: Yellow/Green (medium)
      // Depth 6-8: Blue (small nodes)
      let depth_ratio = f32(hit.depth) / 8.0;
      var base_color: vec3<f32>;
      
      if (hit.depth <= 2u) {
        base_color = vec3<f32>(1.0, 0.0, 0.0); // Red
      } else if (hit.depth <= 4u) {
        base_color = vec3<f32>(1.0, 1.0, 0.0); // Yellow
      } else if (hit.depth <= 6u) {
        base_color = vec3<f32>(0.0, 1.0, 0.0); // Green
      } else {
        base_color = vec3<f32>(0.0, 0.5, 1.0); // Blue
      }
      
      if (is_boundary) {
        // White lines on colored background
        color = mix(base_color, vec3<f32>(1.0), 0.8);
      } else {
        color = base_color;
      }
    }
  }
  // DEBUG: Step count visualization
  else if (camera.debug_step_count > 0.5) {
    if (hit.block_id > 0u) {
      // Color by steps: blue=few steps, red=many steps
      let step_ratio = f32(hit.steps) / f32(MAX_STEPS);
      color = vec3<f32>(step_ratio, 0.2, 1.0 - step_ratio);
    }
  }
  // NORMAL: Face-based shading
  else if (hit.block_id > 0u) {
    // Ensure normal is valid (not zero)
    let normal_length = length(hit.normal);
    if (normal_length < 0.1) {
      // Invalid normal - use default
      color = vec3<f32>(1.0, 0.0, 1.0); // Magenta to highlight the issue
    } else {
      // Use dominant axis for consistent shading
      let abs_nx = abs(hit.normal.x);
      let abs_ny = abs(hit.normal.y);
      let abs_nz = abs(hit.normal.z);
      
      if (abs_ny >= abs_nx && abs_ny >= abs_nz) {
        // Y-dominant: Top/bottom faces
        color = vec3<f32>(0.6, 0.8, 0.6); // Light green
      } else if (abs_nx >= abs_nz) {
        // X-dominant: Left/right faces
        color = vec3<f32>(0.5, 0.7, 0.5); // Medium green
      } else {
        // Z-dominant: Front/back faces
        color = vec3<f32>(0.4, 0.6, 0.4); // Dark green
      }
    }
  }
  
  // Draw crosshair at screen center
  let screen_center = texSize / 2u;
  let dx = abs(i32(pixelCoord.x) - i32(screen_center.x));
  let dy = abs(i32(pixelCoord.y) - i32(screen_center.y));
  
  // Horizontal and vertical lines (10 pixels long, 1 pixel thick)
  if ((dx < 10 && dy == 0) || (dx == 0 && dy < 10)) {
    color = vec3<f32>(1.0, 0.0, 0.0); // Red crosshair
  }
  
  // Debug info for center pixel - store in a buffer or just highlight it
  if (dx == 0 && dy == 0) {
    // Center pixel - make it bright white dot
    color = vec3<f32>(1.0, 1.0, 1.0);
  }
  
  textureStore(outputTexture, pixelCoord, vec4<f32>(color, 1.0));
}