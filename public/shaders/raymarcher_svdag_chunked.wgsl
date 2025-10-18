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
  time: f32,
  max_chunks: u32,
  chunk_size: f32,
  max_depth: u32,
  debug_mode: u32,  // 0=normal, 1=depth, 4=normals, 5=steps, 6=chunks, 7=memory, 8=dag
  max_distance: f32,  // Adaptive: reduces under memory pressure
  max_chunk_steps: u32,  // Adaptive: reduces under memory pressure
  padding: u32,  // Align to 16 bytes
}

struct Hit {
  normal: vec3<f32>,
  block_id: u32,
  distance: f32,
  transparent_distance: f32,
  chunk_index: i32,  // Which chunk we hit
  steps: u32,  // SVDAG traversal steps within chunk
  chunk_steps: u32,  // How many chunks ray traversed
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
@group(0) @binding(7) var<storage, read_write> chunkRequests: array<atomic<u32>>;
@group(0) @binding(8) var<storage, read> chunkHashTable: array<u32>;

const MAX_STACK_DEPTH = 19;
const MAX_STEPS = 256;
const HASH_TABLE_SIZE = 8192u;  // 2x soft limit (3000 chunks * 2.7 = ~8k)
const MAX_PROBE = 32u;  // Max linear probing steps

// ============================================================================
// CHUNK SPACE CONVERSIONS & DDA
// ============================================================================

fn worldToChunk(worldPos: vec3<f32>) -> vec3<i32> {
  // Convert world position to chunk coordinates
  return vec3<i32>(
    i32(floor(worldPos.x / 32.0)),
    i32(floor(worldPos.y / 32.0)),
    i32(floor(worldPos.z / 32.0))
  );
}

fn chunkToRequestIndex(chunkCoord: vec3<i32>, cameraChunk: vec3<i32>, gridSize: i32) -> u32 {
  // Convert chunk coordinate to index in request buffer
  let halfGrid = gridSize / 2;
  let rel = chunkCoord - cameraChunk;
  
  // Out of bounds?
  if (abs(rel.x) > halfGrid || abs(rel.y) > halfGrid || abs(rel.z) > halfGrid) {
    return 0xFFFFFFFFu;
  }
  
  // Convert to grid coordinates [0, gridSize)
  let gx = rel.x + halfGrid;
  let gy = rel.y + halfGrid;
  let gz = rel.z + halfGrid;
  
  return u32(gx + gy * gridSize + gz * gridSize * gridSize);
}

struct DDAState {
  current_chunk: vec3<i32>,
  t_max: vec3<f32>,
  t_delta: vec3<f32>,
  step: vec3<i32>,
}

fn initDDA(ray_origin: vec3<f32>, ray_dir: vec3<f32>) -> DDAState {
  var state: DDAState;
  
  state.current_chunk = worldToChunk(ray_origin);
  
  state.step = vec3<i32>(
    select(-1, 1, ray_dir.x > 0.0),
    select(-1, 1, ray_dir.y > 0.0),
    select(-1, 1, ray_dir.z > 0.0)
  );
  
  state.t_delta = vec3<f32>(
    32.0 / abs(ray_dir.x),
    32.0 / abs(ray_dir.y),
    32.0 / abs(ray_dir.z)
  );
  
  let chunk_min = vec3<f32>(state.current_chunk) * 32.0;
  let chunk_max = chunk_min + vec3<f32>(32.0);
  
  state.t_max = vec3<f32>(
    select((chunk_min.x - ray_origin.x) / ray_dir.x, (chunk_max.x - ray_origin.x) / ray_dir.x, ray_dir.x > 0.0),
    select((chunk_min.y - ray_origin.y) / ray_dir.y, (chunk_max.y - ray_origin.y) / ray_dir.y, ray_dir.y > 0.0),
    select((chunk_min.z - ray_origin.z) / ray_dir.z, (chunk_max.z - ray_origin.z) / ray_dir.z, ray_dir.z > 0.0)
  );
  
  return state;
}

fn stepDDA(state: ptr<function, DDAState>) {
  if ((*state).t_max.x < (*state).t_max.y && (*state).t_max.x < (*state).t_max.z) {
    (*state).current_chunk.x += (*state).step.x;
    (*state).t_max.x += (*state).t_delta.x;
  } else if ((*state).t_max.y < (*state).t_max.z) {
    (*state).current_chunk.y += (*state).step.y;
    (*state).t_max.y += (*state).t_delta.y;
  } else {
    (*state).current_chunk.z += (*state).step.z;
    (*state).t_max.z += (*state).t_delta.z;
  }
}

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

// Spatial hash function for 3D coordinates
fn chunkHash(coord: vec3<i32>) -> u32 {
  // Large primes for good distribution
  let p1 = 73856093u;
  let p2 = 19349663u;
  let p3 = 83492791u;
  
  let h = (u32(coord.x) * p1) ^ (u32(coord.y) * p2) ^ (u32(coord.z) * p3);
  return h;
}

fn getChunkIndexByCoord(chunkCoord: vec3<i32>) -> i32 {
  // Hash table lookup with linear probing
  let hash = chunkHash(chunkCoord);
  var slot = hash % HASH_TABLE_SIZE;
  
  for (var probe = 0u; probe < MAX_PROBE; probe++) {
    let index = chunkHashTable[slot];
    
    if (index == 0xFFFFFFFFu) {
      return -1;  // Empty slot = chunk not found
    }
    
    // Check if this is the chunk we're looking for
    let chunk = chunkMetadata[index];
    let cx = i32(round(chunk.world_offset.x / 32.0));
    let cy = i32(round(chunk.world_offset.y / 32.0));
    let cz = i32(round(chunk.world_offset.z / 32.0));
    
    if (cx == chunkCoord.x && cy == chunkCoord.y && cz == chunkCoord.z) {
      return i32(index);  // Found it!
    }
    
    // Collision - try next slot (linear probing)
    slot = (slot + 1u) % HASH_TABLE_SIZE;
  }
  
  return -1;  // Not found after MAX_PROBE attempts
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
  hit.chunk_steps = 0u;
  
  if (chunkIdx < 0) {
    return hit;
  }
  
  let chunk = chunkMetadata[u32(chunkIdx)];
  
  // Prevent division by zero when ray is parallel to axis (CRITICAL for precision!)
  let eps = 1e-8;
  let safe_ray_dir = vec3<f32>(
    select(ray_dir.x, eps, abs(ray_dir.x) < eps),
    select(ray_dir.y, eps, abs(ray_dir.y) < eps),
    select(ray_dir.z, eps, abs(ray_dir.z) < eps)
  );
  let inv_ray_dir = vec3<f32>(1.0) / safe_ray_dir;
  
  // CRITICAL: Do chunk AABB test in WORLD space
  let chunk_min_world = chunk.world_offset;
  let chunk_max_world = chunk.world_offset + vec3<f32>(chunk.chunk_size);
  let t0_chunk = (chunk_min_world - ray_origin) * inv_ray_dir;
  let t1_chunk = (chunk_max_world - ray_origin) * inv_ray_dir;
  let tmin_chunk = min(t0_chunk, t1_chunk);
  let tmax_chunk = max(t0_chunk, t1_chunk);
  let t_enter = max(max(tmin_chunk.x, tmin_chunk.y), tmin_chunk.z);
  let t_exit = min(min(tmax_chunk.x, tmax_chunk.y), tmax_chunk.z);
  
  // Ray misses chunk
  if (t_enter > t_exit) {
    return hit;
  }
  
  // Chunk is completely behind ray
  if (t_exit < 0.0) {
    return hit;
  }
  
  // t_start is where ray enters chunk
  let t_start = max(t_enter, 0.0);
  
  // DON'T convert to local - keep everything in world space!
  // (Nodes will be offset by chunk.world_offset)
  let world_origin = ray_origin;
  
  // Get root index and node count for this chunk
  let root_idx = select(chunk.material_root, chunk.opaque_root, useOpaque);
  let node_count = select(chunk.material_node_count, chunk.opaque_node_count, useOpaque);
  
  // Empty chunk check: node_count == 0, NOT root_idx == 0!
  // (root_idx = 0 is VALID - it's the first node in the array)
  if (node_count == 0u) {
    return hit; // Empty chunk
  }
  
  // Setup for traversal (MATCH REFERENCE SHADER)
  var stack: array<StackEntry, MAX_STACK_DEPTH>;
  var stack_size = 0;
  
  let world_size = chunk.chunk_size;
  
  // Initialize stack with root at CHUNK CENTER in WORLD coordinates!
  let chunk_local_center = vec3<f32>(world_size * 0.5);
  let chunk_world_center = chunk.world_offset + chunk_local_center;
  stack[0].packed_idx_depth = packIdxDepth(root_idx, 0u);
  stack[0].pos_xyz = chunk_world_center;  // WORLD coordinates!
  stack_size = 1;
  
  var step_count = 0u;
  var current_t = t_start;  // Track our progress along the ray (starts at chunk entry)
  
  while (stack_size > 0 && step_count < u32(MAX_STEPS)) {
    step_count++;
    hit.steps = step_count;
    stack_size--;
    
    let entry = stack[stack_size];
    let node_idx = unpackNodeIdx(entry.packed_idx_depth);
    let depth = unpackDepth(entry.packed_idx_depth);
    let node_center = entry.pos_xyz;  // This is now CENTER
    
    // Calculate node size and half-size
    let node_size = world_size / f32(1u << depth);
    let node_half = node_size * 0.5;
    
    // Calculate AABB from CENTER in WORLD space (node_center is already in world coords)
    let node_min = node_center - vec3<f32>(node_half);
    let node_max = node_center + vec3<f32>(node_half);
    let t0 = (node_min - world_origin) * inv_ray_dir;
    let t1 = (node_max - world_origin) * inv_ray_dir;
    let tmin = min(t0, t1);
    let tmax = max(t0, t1);
    let t_near = max(max(tmin.x, tmin.y), tmin.z);
    let t_far = min(min(tmax.x, tmax.y), tmax.z);
    
    // Update current_t to where we enter this node, but never go backward!
    // (Reference sets current_t = max(t_near, 0.0), but we need to also respect t_start)
    current_t = max(max(t_near, 0.0), t_start);
    
    // Skip if ray doesn't hit this node
    if (t_near > t_far) {
      continue;
    }
    
    // Skip if beyond max distance
    if (current_t >= maxDist) {
      continue;
    }
    
    // Read node data (node_idx IS the array index, not a node number!)
    let node_tag = svdag_nodes[node_idx];
    let node_data1 = svdag_nodes[node_idx + 1u];
    
    // Leaf node - we hit geometry!
    if (node_tag == 1u) {
      let leaf_idx = node_data1;
      let block_id = svdag_leaves[leaf_idx];
      
      // Found geometry!
      hit.distance = current_t;
      hit.block_id = select(block_id, 1u, block_id == 0u); // If 0, use 1 as fallback
      
      // Calculate normal from AABB entry face (RECALCULATE like reference shader line 436-439)
      // Must recalculate because t0/t1 are loop variables that get overwritten
      let leaf_min = node_center - vec3<f32>(node_half);
      let leaf_max = node_center + vec3<f32>(node_half);
      let t0_leaf = (leaf_min - world_origin) * inv_ray_dir;
      let t1_leaf = (leaf_max - world_origin) * inv_ray_dir;
      let t_near_vec = min(t0_leaf, t1_leaf);
      let t_entry = max(max(t_near_vec.x, t_near_vec.y), t_near_vec.z);
      
      // Determine which face we hit (with adaptive epsilon for precision)
      let epsilon = max(0.001, abs(t_entry) * 0.00001);
      if (abs(t_entry - t_near_vec.x) < epsilon) {
        hit.normal = vec3<f32>(-sign(ray_dir.x), 0.0, 0.0);
      } else if (abs(t_entry - t_near_vec.y) < epsilon) {
        hit.normal = vec3<f32>(0.0, -sign(ray_dir.y), 0.0);
      } else {
        hit.normal = vec3<f32>(0.0, 0.0, -sign(ray_dir.z));
      }
      
      return hit;
    }
    
    // Inner node - traverse children (CENTER-BASED like reference)
    let child_mask = node_data1;
    let child_size = node_size * 0.5;
    let child_half = child_size * 0.5;
    
    // DDA ordering: traverse children front-to-back (CRITICAL for correctness!)
    let ray_sign_x = u32(ray_dir.x >= 0.0);
    let ray_sign_y = u32(ray_dir.y >= 0.0);
    let ray_sign_z = u32(ray_dir.z >= 0.0);
    
    for (var i = 0u; i < 8u; i++) {
      // XOR with ray signs to get front-to-back order (match reference line 469)
      let octant = i ^ (ray_sign_x | (ray_sign_y << 1u) | (ray_sign_z << 2u));
      
      if ((child_mask & (1u << octant)) != 0u) {
        let cx = f32(octant & 1u);
        let cy = f32((octant >> 1u) & 1u);
        let cz = f32((octant >> 2u) & 1u);
        
        // Calculate child CENTER in WORLD space (node_center is already world coords)
        let child_offset = vec3<f32>(cx - 0.5, cy - 0.5, cz - 0.5) * child_size;
        let child_center = node_center + child_offset;
        
        // Ray-AABB intersection test in WORLD space
        let child_min = child_center - vec3<f32>(child_half);
        let child_max = child_center + vec3<f32>(child_half);
        let t0 = (child_min - world_origin) * inv_ray_dir;
        let t1 = (child_max - world_origin) * inv_ray_dir;
        let tmin_vec = min(t0, t1);
        let tmax_vec = max(t0, t1);
        let t_near = max(max(tmin_vec.x, tmin_vec.y), tmin_vec.z);
        let t_far = min(min(tmax_vec.x, tmax_vec.y), tmax_vec.z);
        
        // Only traverse if child is hit AND extends past current position (match reference line 495)
        if (t_near <= t_far && t_far >= current_t) {
          // Count how many children come before this octant in the mask
          let child_count = countOneBits(child_mask & ((1u << octant) - 1u));
          // Child indices start at node_idx + 2
          let child_idx = svdag_nodes[node_idx + 2u + child_count];
          
          if (stack_size < MAX_STACK_DEPTH) {
            stack[stack_size].packed_idx_depth = packIdxDepth(child_idx, depth + 1u);
            stack[stack_size].pos_xyz = child_center;  // Store CENTER
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
  var closest_hit: Hit;
  closest_hit.distance = -1.0;
  closest_hit.block_id = 0u;
  closest_hit.chunk_index = -1;
  closest_hit.steps = 0u;
  closest_hit.chunk_steps = 0u;
  
  // Adaptive limits based on memory pressure
  let max_dist = renderParams.max_distance;
  let max_steps = renderParams.max_chunk_steps;
  
  let camera_chunk = worldToChunk(camera.position);
  
  // Initialize DDA
  var dda = initDDA(ray_origin, ray_dir);
  var steps = 0u;  // u32 to match Hit.chunk_steps
  
  // March through chunk grid using DDA
  while (steps < max_steps) {
    steps++;
    
    // Check if ray has traveled too far
    let t_current = min(min(dda.t_max.x, dda.t_max.y), dda.t_max.z);
    if (t_current > max_dist) {
      break;
    }
    
    // Try to find this chunk
    let chunkIdx = getChunkIndexByCoord(dda.current_chunk);
    
    if (chunkIdx == -1) {
      // CHUNK NOT LOADED - Request it!
      let requestIdx = chunkToRequestIndex(dda.current_chunk, camera_chunk, 33);
      if (requestIdx != 0xFFFFFFFFu) {
        atomicAdd(&chunkRequests[requestIdx], 1u);
      }
      
      // Return miss (sky color) - hole this frame
      closest_hit.distance = t_current;
      closest_hit.chunk_steps = steps;  // Track how many chunks we stepped through
      return closest_hit;
    }
    
    // Chunk is loaded - traverse its SVDAG
    var chunk_hit = traverseSVDAG(ray_origin, ray_dir, chunkIdx, false, max_dist);
    
    if (chunk_hit.distance >= 0.0 && chunk_hit.distance < max_dist) {
      // Found a voxel!
      chunk_hit.chunk_steps = steps;  // Track how many chunks we stepped through
      return chunk_hit;
    }
    
    // Chunk was air - continue to next chunk
    stepDDA(&dda);
  }
  
  // No hit - return with chunk step count
  closest_hit.chunk_steps = steps;
  return closest_hit;
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
  
  // Debug mode 4: Normals
  if (renderParams.debug_mode == 4u) {
    if (hit.distance < 0.0) {
      return vec3<f32>(0.0, 0.0, 0.0);
    }
    return hit.normal * 0.5 + 0.5; // Map -1..1 to 0..1
  }
  
  // Debug mode 5: Chunk step count heatmap (how many chunks ray traversed)
  if (renderParams.debug_mode == 5u) {
    let steps_normalized = clamp(f32(hit.chunk_steps) / 64.0, 0.0, 1.0);
    // Blue (cold/few chunks) -> Green -> Yellow -> Red (hot/many chunks)
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
  
  // Debug mode 6: Chunk boundaries
  if (renderParams.debug_mode == 6u) {
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
  
  // Debug mode 7: Memory pressure heatmap
  if (renderParams.debug_mode == 7u) {
    let memory_pressure = f32(renderParams.max_chunks) / 600.0;
    // Green = low, Yellow = medium, Red = high memory usage
    var color = vec3<f32>(0.0);
    if (memory_pressure < 0.5) {
      color = mix(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 1.0, 0.0), memory_pressure * 2.0);
    } else {
      color = mix(vec3<f32>(1.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), (memory_pressure - 0.5) * 2.0);
    }
    // Show chunks loaded as text overlay would be nice, but just use solid color
    return color;
  }
  
  // Debug mode 8: DAG activity (shows where DAG traversal is happening)
  if (renderParams.debug_mode == 8u) {
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
