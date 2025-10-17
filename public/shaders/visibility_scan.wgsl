/**
 * Visibility Scan Shader
 * Low-resolution ray cast to detect which chunks are needed
 * Outputs chunk coordinates that rays attempt to traverse
 */

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

struct RenderParams {
  resolution: vec2<f32>,
  time: f32,
  max_distance: f32,
  chunk_size: f32,
  view_distance_chunks: f32,
}

struct ChunkMetadata {
  world_offset: vec3<f32>,
  chunk_size: f32,
  material_root: u32,
  opaque_root: u32,
  material_node_count: u32,
  opaque_node_count: u32,
}

struct ChunkRequest {
  chunk_x: i32,
  chunk_y: i32,
  chunk_z: i32,
  priority: f32,  // Based on distance and screen coverage
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> renderParams: RenderParams;
@group(0) @binding(2) var<storage, read> chunkMetadata: array<ChunkMetadata>;
@group(0) @binding(3) var<storage, read_write> chunkRequests: array<atomic<u32>>;  // Flattened 3D grid of chunks

// Convert world position to chunk coordinates
fn worldToChunk(world_pos: vec3<f32>) -> vec3<i32> {
  return vec3<i32>(
    i32(floor(world_pos.x / renderParams.chunk_size)),
    i32(floor(world_pos.y / renderParams.chunk_size)),
    i32(floor(world_pos.z / renderParams.chunk_size))
  );
}

// Convert chunk coords to request buffer index
fn chunkToIndex(chunk_x: i32, chunk_y: i32, chunk_z: i32) -> u32 {
  // Map to grid centered on camera
  // Assume grid is [-VIEW_DISTANCE, +VIEW_DISTANCE] in each axis
  let grid_size = i32(renderParams.view_distance_chunks * 2.0 + 1.0);
  let center = worldToChunk(camera.position);
  
  // Relative to center
  let rel_x = chunk_x - center.x + i32(renderParams.view_distance_chunks);
  let rel_y = chunk_y - center.y + i32(renderParams.view_distance_chunks);
  let rel_z = chunk_z - center.z + i32(renderParams.view_distance_chunks);
  
  // Bounds check
  if (rel_x < 0 || rel_x >= grid_size || 
      rel_y < 0 || rel_y >= grid_size || 
      rel_z < 0 || rel_z >= grid_size) {
    return 0xFFFFFFFF;  // Out of bounds
  }
  
  return u32(rel_x + rel_y * grid_size + rel_z * grid_size * grid_size);
}

// Ray-AABB intersection (returns true if hit, t_enter in t.x, t_exit in t.y)
fn rayAABB(ray_origin: vec3<f32>, ray_dir: vec3<f32>, box_min: vec3<f32>, box_max: vec3<f32>) -> vec2<f32> {
  let eps = 1e-8;
  let safe_dir = vec3<f32>(
    select(ray_dir.x, eps, abs(ray_dir.x) < eps),
    select(ray_dir.y, eps, abs(ray_dir.y) < eps),
    select(ray_dir.z, eps, abs(ray_dir.z) < eps)
  );
  let inv_dir = vec3<f32>(1.0) / safe_dir;
  
  let t0 = (box_min - ray_origin) * inv_dir;
  let t1 = (box_max - ray_origin) * inv_dir;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  let t_enter = max(max(tmin.x, tmin.y), tmin.z);
  let t_exit = min(min(tmax.x, tmax.y), tmax.z);
  
  return vec2<f32>(t_enter, t_exit);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let scan_res = vec2<u32>(u32(renderParams.resolution.x), u32(renderParams.resolution.y));
  
  // Skip out-of-bounds threads
  if (global_id.x >= scan_res.x || global_id.y >= scan_res.y) {
    return;
  }
  
  // Generate ray for this scan pixel
  let uv = vec2<f32>(
    (f32(global_id.x) + 0.5) / f32(scan_res.x),
    (f32(global_id.y) + 0.5) / f32(scan_res.y)
  );
  
  // NDC coordinates
  let ndc = uv * 2.0 - 1.0;
  
  // Ray direction (use camera.aspect from uniform, not calculated)
  let fov_factor = tan(camera.fov * 0.5);
  let ray_dir = normalize(
    camera.forward +
    camera.right * ndc.x * fov_factor * camera.aspect +
    camera.up * ndc.y * fov_factor
  );
  
  let ray_origin = camera.position;
  let max_dist = renderParams.max_distance;
  
  // DDA through chunk grid
  // Start at camera chunk, step along ray
  var current_chunk = worldToChunk(ray_origin);
  let ray_sign = sign(ray_dir);
  let ray_step = vec3<i32>(
    i32(ray_sign.x),
    i32(ray_sign.y),
    i32(ray_sign.z)
  );
  
  // Calculate t_max and t_delta for DDA
  let chunk_size = renderParams.chunk_size;
  var t = 0.0;
  let max_steps = i32(renderParams.view_distance_chunks * 2.0 + 5.0);  // Diagonal can be longer
  
  for (var step = 0; step < max_steps; step++) {
    // Mark this chunk as needed
    let idx = chunkToIndex(current_chunk.x, current_chunk.y, current_chunk.z);
    if (idx != 0xFFFFFFFF) {
      // Atomic increment to mark chunk as requested
      atomicAdd(&chunkRequests[idx], 1u);
    }
    
    // Calculate chunk bounds
    let chunk_min = vec3<f32>(
      f32(current_chunk.x) * chunk_size,
      f32(current_chunk.y) * chunk_size,
      f32(current_chunk.z) * chunk_size
    );
    let chunk_max = chunk_min + vec3<f32>(chunk_size);
    
    // Find where ray exits current chunk
    let t_bounds = rayAABB(ray_origin, ray_dir, chunk_min, chunk_max);
    let t_exit = t_bounds.y;
    
    // Step to next chunk
    t = t_exit + 0.01;  // Small epsilon to enter next chunk
    
    // Check distance limit
    if (t >= max_dist) {
      break;
    }
    
    // Determine which face we're exiting through
    let exit_point = ray_origin + ray_dir * t_exit;
    let epsilon = 0.01;
    
    // Step to next chunk based on exit face
    if (abs(exit_point.x - chunk_min.x) < epsilon && ray_dir.x < 0.0) {
      current_chunk.x -= 1;
    } else if (abs(exit_point.x - chunk_max.x) < epsilon && ray_dir.x > 0.0) {
      current_chunk.x += 1;
    }
    
    if (abs(exit_point.y - chunk_min.y) < epsilon && ray_dir.y < 0.0) {
      current_chunk.y -= 1;
    } else if (abs(exit_point.y - chunk_max.y) < epsilon && ray_dir.y > 0.0) {
      current_chunk.y += 1;
    }
    
    if (abs(exit_point.z - chunk_min.z) < epsilon && ray_dir.z < 0.0) {
      current_chunk.z -= 1;
    } else if (abs(exit_point.z - chunk_max.z) < epsilon && ray_dir.z > 0.0) {
      current_chunk.z += 1;
    }
  }
}
