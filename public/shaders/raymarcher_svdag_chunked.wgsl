// ============================================================================
// Multi-Chunk SVDAG Raymarcher - Infinite World Support
// Based on raymarcher_svdagWORKSGREATOCT14.wgsl
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

struct ChunkMetadata {
  world_offset: vec3<f32>,      // Chunk position in world space
  chunk_size: f32,              // Size of chunk (32)
  material_root: u32,           // Root index for material SVDAG
  material_node_count: u32,     // Number of nodes in material SVDAG
  opaque_root: u32,             // Root index for opaque SVDAG
  opaque_node_count: u32,       // Number of nodes in opaque SVDAG
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

// TimeParams removed - not used yet (can add back with fog/lighting later)

struct RenderParams {
  max_chunks: u32,
  chunk_size: f32,
  max_depth: u32,
  debug_mode: u32,  // 0=normal, 1=depth, 2=chunks, 3=normals, 4=steps, 5=dag activity
}

struct Hit {
  normal: vec3<f32>,
  block_id: u32,
  distance: f32,
  transparent_distance: f32,
  chunk_index: i32,  // Which chunk we hit
  steps: u32,  // How many steps to find this hit
}

struct StackEntry {
  packed_idx_depth: u32,
  pos_xyz: vec3<f32>,
}

fn packIdxDepth(node_idx: u32, depth: u32) -> u32 {
  return (node_idx & 0xFFFFu) | ((depth & 0xFFu) << 16u);
}

fn unpackNodeIdx(packed: u32) -> u32 {
  return packed & 0xFFFFu;
}

fn unpackDepth(packed: u32) -> u32 {
  return (packed >> 16u) & 0xFFu;
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> renderParams: RenderParams;
@group(0) @binding(2) var<storage, read> chunkMetadata: array<ChunkMetadata>;
@group(0) @binding(3) var<storage, read> svdag_nodes: array<u32>;
@group(0) @binding(4) var<storage, read> svdag_leaves: array<u32>;
@group(0) @binding(5) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(6) var<storage, read> materials: array<BlockMaterial>;

const MAX_STACK_DEPTH = 19;
const MAX_STEPS = 256;

// ============================================================================
// CHUNK MANAGEMENT
// ============================================================================

fn getChunkIndex(worldPos: vec3<f32>) -> i32 {
  for (var i = 0u; i < renderParams.max_chunks; i++) {
    let chunk = chunkMetadata[i];
    let localPos = worldPos - chunk.world_offset;
    
    // Check if position is inside this chunk
    if (localPos.x >= 0.0 && localPos.x < chunk.chunk_size &&
        localPos.y >= 0.0 && localPos.y < chunk.chunk_size &&
        localPos.z >= 0.0 && localPos.z < chunk.chunk_size) {
      return i32(i);
    }
  }
  
  return -1; // No chunk at this position
}

fn worldToChunkLocal(worldPos: vec3<f32>, chunkIdx: i32) -> vec3<f32> {
  if (chunkIdx < 0) {
    return vec3<f32>(0.0);
  }
  
  let chunk = chunkMetadata[u32(chunkIdx)];
  return worldPos - chunk.world_offset;
}

// ============================================================================
// SVDAG TRAVERSAL (Per-Chunk)
// ============================================================================

fn traverseSVDAG(
  ray_origin: vec3<f32>,
  ray_dir: vec3<f32>,
  chunkIdx: i32,
  useOpaque: bool,
  maxDist: f32
) -> Hit {
  var hit: Hit;
  hit.distance = -1.0;
  hit.block_id = 0u;
  hit.transparent_distance = 0.0;
  hit.chunk_index = chunkIdx;
  hit.steps = 0u;
  
  if (chunkIdx < 0) {
    return hit;
  }
  
  let chunk = chunkMetadata[u32(chunkIdx)];
  
  // Convert to chunk-local coordinates
  let local_origin = worldToChunkLocal(ray_origin, chunkIdx);
  
  // Get root index and node count for this chunk
  let root_idx = select(chunk.material_root, chunk.opaque_root, useOpaque);
  let node_count = select(chunk.material_node_count, chunk.opaque_node_count, useOpaque);
  
  // Empty chunk check: node_count == 0, NOT root_idx == 0!
  // (root_idx = 0 is VALID - it's the first node in the array)
  if (node_count == 0u) {
    return hit; // Empty chunk
  }
  
  // Setup for traversal
  var stack: array<StackEntry, MAX_STACK_DEPTH>;
  var stack_size = 0;
  
  let world_size = chunk.chunk_size;
  let inv_ray_dir = vec3<f32>(1.0) / ray_dir;
  
  // Initialize stack with root
  stack[0].packed_idx_depth = packIdxDepth(root_idx, 0u);
  stack[0].pos_xyz = vec3<f32>(0.0);
  stack_size = 1;
  
  var step_count = 0u;
  
  while (stack_size > 0 && step_count < u32(MAX_STEPS)) {
    step_count++;
    hit.steps = step_count;
    stack_size--;
    
    let entry = stack[stack_size];
    let node_idx = unpackNodeIdx(entry.packed_idx_depth);
    let depth = unpackDepth(entry.packed_idx_depth);
    let node_pos = entry.pos_xyz;
    
    // Calculate node size
    let node_size = world_size / f32(1u << depth);
    
    // Read node data (node_idx IS the array index, not a node number!)
    let node_tag = svdag_nodes[node_idx];
    let node_data1 = svdag_nodes[node_idx + 1u];
    
    // Leaf node
    if (node_tag == 1u) {
      let leaf_idx = node_data1;
      let block_id = svdag_leaves[leaf_idx];
      
      // Ray-AABB intersection (check even if block_id == 0 for debug)
      let t_min = (node_pos - local_origin) * inv_ray_dir;
      let t_max = (node_pos + vec3<f32>(node_size) - local_origin) * inv_ray_dir;
      let t1 = min(t_min, t_max);
      let t2 = max(t_min, t_max);
      let t_near = max(max(t1.x, t1.y), t1.z);
      let t_far = min(min(t2.x, t2.y), t2.z);
      
      if (t_near <= t_far && t_far > 0.0 && t_near < maxDist) {
        // Found geometry! Set block_id even if it's 0
        hit.distance = max(t_near, 0.0);
        hit.block_id = select(block_id, 1u, block_id == 0u); // If 0, use 1 as fallback
        
        // Calculate normal
        let hit_point = local_origin + ray_dir * hit.distance;
        let center = node_pos + vec3<f32>(node_size * 0.5);
        let d = abs(hit_point - center);
        let max_d = max(max(d.x, d.y), d.z);
        
        if (max_d == d.x) {
          hit.normal = vec3<f32>(sign(hit_point.x - center.x), 0.0, 0.0);
        } else if (max_d == d.y) {
          hit.normal = vec3<f32>(0.0, sign(hit_point.y - center.y), 0.0);
        } else {
          hit.normal = vec3<f32>(0.0, 0.0, sign(hit_point.z - center.z));
        }
        
        return hit;
      }
      continue;
    }
    
    // Inner node - traverse children
    let child_mask = node_data1;
    let child_size = node_size * 0.5;
    
    // DDA traversal of children
    for (var i = 0u; i < 8u; i++) {
      if ((child_mask & (1u << i)) != 0u) {
        let cx = f32(i & 1u);
        let cy = f32((i >> 1u) & 1u);
        let cz = f32((i >> 2u) & 1u);
        let child_pos = node_pos + vec3<f32>(cx, cy, cz) * child_size;
        
        // Ray-AABB intersection test
        let t_min = (child_pos - local_origin) * inv_ray_dir;
        let t_max = (child_pos + vec3<f32>(child_size) - local_origin) * inv_ray_dir;
        let t1 = min(t_min, t_max);
        let t2 = max(t_min, t_max);
        let t_near = max(max(t1.x, t1.y), t1.z);
        let t_far = min(min(t2.x, t2.y), t2.z);
        
        if (t_near <= t_far && t_far > 0.0) {
          // Count how many children come before this one in the mask
          let child_count = countOneBits(child_mask & ((1u << i) - 1u));
          // Child indices start at node_idx + 2
          let child_idx = svdag_nodes[node_idx + 2u + child_count];
          
          if (stack_size < MAX_STACK_DEPTH) {
            stack[stack_size].packed_idx_depth = packIdxDepth(child_idx, depth + 1u);
            stack[stack_size].pos_xyz = child_pos;
            stack_size++;
          }
        }
      }
    }
  }
  
  return hit;
}

// ============================================================================
// MULTI-CHUNK RAYMARCHING
// ============================================================================

fn raymarchChunks(ray_origin: vec3<f32>, ray_dir: vec3<f32>) -> Hit {
  var hit: Hit;
  hit.distance = -1.0;
  hit.block_id = 0u;
  hit.chunk_index = -1;
  hit.steps = 0u;
  
  var current_pos = ray_origin;
  var traveled = 0.0;
  let max_dist = 200.0; // Reduced render distance
  let step_size = renderParams.chunk_size * 0.5; // Smaller steps for better detection
  
  var total_steps = 0u;
  var chunks_checked = 0u;
  
  for (var i = 0; i < 16; i++) { // Max 16 chunk checks (reduced)
    if (traveled >= max_dist) {
      break;
    }
    
    chunks_checked++;
    
    // Which chunk are we in?
    let chunkIdx = getChunkIndex(current_pos);
    
    if (chunkIdx >= 0) {
      // Traverse this chunk's SVDAG
      let chunk_hit = traverseSVDAG(current_pos, ray_dir, chunkIdx, false, max_dist - traveled);
      total_steps += chunk_hit.steps;
      
      if (chunk_hit.distance >= 0.0) {
        hit = chunk_hit;
        hit.distance += traveled;
        hit.steps = total_steps;
        return hit;
      }
    }
    
    // Step to next potential chunk
    current_pos += ray_dir * step_size;
    traveled += step_size;
  }
  
  // Miss - but record steps
  hit.steps = total_steps;
  return hit;
}

// ============================================================================
// RENDERING
// ============================================================================

fn shade(hit: Hit, ray_dir: vec3<f32>) -> vec3<f32> {
  // Debug mode 1: Depth map with color
  if (renderParams.debug_mode == 1u) {
    if (hit.distance < 0.0 || hit.block_id == 0u) {
      return vec3<f32>(0.1, 0.1, 0.2); // Dark blue = miss
    }
    let depth = clamp(hit.distance / 100.0, 0.0, 1.0);
    // Red = close, yellow = medium, cyan = far
    let r = 1.0 - depth;
    let g = 1.0 - abs(depth - 0.5) * 2.0;
    let b = depth;
    return vec3<f32>(r, g, b);
  }
  
  // Debug mode 2: Chunk boundaries
  if (renderParams.debug_mode == 2u) {
    if (hit.distance < 0.0) {
      return vec3<f32>(0.1, 0.1, 0.1); // Dark gray = miss
    }
    // Get chunk world position for unique color
    let chunk = chunkMetadata[u32(hit.chunk_index)];
    let cx = i32(chunk.world_offset.x / 32.0);
    let cy = i32(chunk.world_offset.y / 32.0);
    let cz = i32(chunk.world_offset.z / 32.0);
    
    // Hash chunk coords to get unique color per chunk
    let hash = (cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791);
    let r = f32((hash & 0xFF)) / 255.0;
    let g = f32(((hash >> 8) & 0xFF)) / 255.0;
    let b = f32(((hash >> 16) & 0xFF)) / 255.0;
    
    return vec3<f32>(r, g, b);
  }
  
  // Debug mode 3: Normals (ignore block_id - show ANY hit)
  if (renderParams.debug_mode == 3u) {
    if (hit.distance < 0.0) {
      return vec3<f32>(0.0, 0.0, 0.0);
    }
    // Show normals even if block_id is 0
    return hit.normal * 0.5 + 0.5; // Map -1..1 to 0..1
  }
  
  // Debug mode 4: Step count heatmap
  if (renderParams.debug_mode == 4u) {
    let steps_normalized = clamp(f32(hit.steps) / 100.0, 0.0, 1.0);
    // Blue (cold/few steps) -> Green -> Yellow -> Red (hot/many steps)
    var color = vec3<f32>(0.0);
    if (steps_normalized < 0.25) {
      // Blue to cyan
      let t = steps_normalized * 4.0;
      color = mix(vec3<f32>(0.0, 0.0, 0.5), vec3<f32>(0.0, 1.0, 1.0), t);
    } else if (steps_normalized < 0.5) {
      // Cyan to green
      let t = (steps_normalized - 0.25) * 4.0;
      color = mix(vec3<f32>(0.0, 1.0, 1.0), vec3<f32>(0.0, 1.0, 0.0), t);
    } else if (steps_normalized < 0.75) {
      // Green to yellow
      let t = (steps_normalized - 0.5) * 4.0;
      color = mix(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 1.0, 0.0), t);
    } else {
      // Yellow to red
      let t = (steps_normalized - 0.75) * 4.0;
      color = mix(vec3<f32>(1.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), t);
    }
    return color;
  }
  
  // Debug mode 5: DAG activity (shows where DAG traversal is happening)
  if (renderParams.debug_mode == 5u) {
    if (hit.steps == 0u) {
      return vec3<f32>(0.0, 0.0, 0.0); // Black = no work
    }
    if (hit.distance < 0.0) {
      // Missed but did work (checked chunks/nodes)
      let activity = clamp(f32(hit.steps) / 50.0, 0.0, 1.0);
      return vec3<f32>(0.5, 0.0, 0.5) * activity; // Purple = checked but missed
    }
    // Hit something
    let activity = clamp(f32(hit.steps) / 100.0, 0.0, 1.0);
    return vec3<f32>(0.0, 1.0, 0.0) * (0.5 + activity * 0.5); // Green = found
  }
  
  // Normal rendering
  if (hit.distance < 0.0 || hit.block_id == 0u) {
    // Sky
    let t = ray_dir.y * 0.5 + 0.5;
    return mix(vec3<f32>(0.5, 0.7, 1.0), vec3<f32>(0.1, 0.3, 0.8), t);
  }
  
  // Get material - use block_id to pick color
  // If materials are broken, generate color from block_id
  var final_color = vec3<f32>(0.3, 0.8, 0.3); // Default green
  
  if (hit.block_id > 0u && hit.block_id <= 15u) {
    let mat = materials[hit.block_id];
    let base_color = vec3<f32>(mat.colorR, mat.colorG, mat.colorB);
    let color_brightness = base_color.r + base_color.g + base_color.b;
    
    if (color_brightness > 0.1) {
      // Material has valid color
      final_color = base_color;
    } else {
      // Material is black - generate color from block_id
      let id_f = f32(hit.block_id);
      final_color = vec3<f32>(
        0.3 + (id_f * 0.23) % 0.7,
        0.3 + (id_f * 0.37) % 0.7,
        0.3 + (id_f * 0.51) % 0.7
      );
    }
  }
  
  // Simple lighting
  let light_dir = normalize(vec3<f32>(0.5, 1.0, 0.3));
  let ndotl = max(dot(hit.normal, light_dir), 0.0);
  let ambient = 0.4;
  let diffuse = ndotl * 0.6;
  
  return final_color * (ambient + diffuse);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let dims = textureDimensions(outputTexture);
  if (global_id.x >= dims.x || global_id.y >= dims.y) {
    return;
  }
  
  // Generate ray
  let uv = (vec2<f32>(global_id.xy) / vec2<f32>(dims)) * 2.0 - 1.0;
  let aspect = camera.aspect;
  let tan_half_fov = tan(camera.fov * 0.5);
  
  let ray_dir = normalize(
    camera.forward +
    camera.right * uv.x * aspect * tan_half_fov +
    camera.up * uv.y * tan_half_fov
  );
  
  // Raymarch through chunks
  let hit = raymarchChunks(camera.position, ray_dir);
  
  // Shade
  let color = shade(hit, ray_dir);
  
  textureStore(outputTexture, global_id.xy, vec4<f32>(color, 1.0));
}
