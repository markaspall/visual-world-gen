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
}

struct Params {
  lod0Res: u32,
  lod1Res: u32,
  lod2Res: u32,
  lod3Res: u32,
}

struct TimeParams {
  time: f32,
  timeOfDay: f32,      // 0-1 (0=midnight, 0.25=sunrise, 0.5=noon, 0.75=sunset)
  fogDistance: f32,    // Distance where fog is at max
  fogDensity: f32,     // Fog strength multiplier
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
  animType: f32,     // 0=ripples, 1=flow, 2=sway, 3=shimmer
  speed: f32,
  scale: f32,
  strength: f32,
  octaves: f32,
  dirX: f32,
  dirY: f32,
  _pad: f32,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read> heightLOD0: array<f32>;
@group(0) @binding(3) var<storage, read> heightLOD1: array<f32>;
@group(0) @binding(4) var<storage, read> heightLOD2: array<f32>;
@group(0) @binding(5) var<storage, read> heightLOD3: array<f32>;
@group(0) @binding(6) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(7) var<storage, read> blocksMap: array<u32>;
@group(0) @binding(8) var<storage, read> waterMap: array<f32>;
@group(0) @binding(9) var<storage, read> materials: array<BlockMaterial>;
@group(0) @binding(10) var<uniform> timeParams: TimeParams;
@group(0) @binding(11) var<storage, read> animations: array<Animation>;

// Voxel size in meters
const VOXEL_SIZE = 0.333333;

// World size in voxels (heightmap is 512×512 voxels)
const WORLD_VOXELS = 512.0;

// Atmospheric constants
const PI = 3.14159265359;

// Get sun direction based on time of day (0-1)
fn getSunDirection(timeOfDay: f32) -> vec3<f32> {
  // Sun moves in arc from east to west
  // timeOfDay: 0=midnight, 0.25=sunrise, 0.5=noon, 0.75=sunset
  let angle = timeOfDay * 2.0 * PI;
  
  // Sun angle: rises in east, peaks at noon, sets in west
  let elevation = sin(angle); // -1 to 1
  let azimuth = cos(angle);
  
  return normalize(vec3<f32>(azimuth, elevation, 0.3));
}

// Get sky color based on sun position
fn getSkyColor(rayDir: vec3<f32>, sunDir: vec3<f32>) -> vec3<f32> {
  let sunDot = max(dot(rayDir, sunDir), 0.0);
  let horizonDot = abs(rayDir.y);
  
  // Smooth blend between day/sunset/night based on sun elevation
  let sunElevation = sunDir.y;
  
  // Define color palettes
  let dayColor = vec3<f32>(0.4, 0.7, 1.0);
  let dayHorizon = vec3<f32>(0.7, 0.85, 1.0);
  let daySun = vec3<f32>(1.0, 0.95, 0.8);
  
  let sunsetColor = vec3<f32>(0.4, 0.3, 0.6);
  let sunsetHorizon = vec3<f32>(1.0, 0.5, 0.3);
  let sunsetSun = vec3<f32>(1.0, 0.4, 0.2);
  
  let nightColor = vec3<f32>(0.01, 0.01, 0.05);
  let nightHorizon = vec3<f32>(0.02, 0.02, 0.08);
  let nightSun = vec3<f32>(0.8, 0.8, 0.9); // Moon - brighter and whiter
  
  // Smooth transitions using smoothstep
  var skyColor: vec3<f32>;
  var horizonColor: vec3<f32>;
  var sunColor: vec3<f32>;
  
  if (sunElevation > 0.3) {
    // Full day
    skyColor = dayColor;
    horizonColor = dayHorizon;
    sunColor = daySun;
  } else if (sunElevation > -0.1) {
    // Sunset/sunrise transition
    let t = smoothstep(-0.1, 0.3, sunElevation);
    skyColor = mix(sunsetColor, dayColor, t);
    horizonColor = mix(sunsetHorizon, dayHorizon, t);
    sunColor = mix(sunsetSun, daySun, t);
  } else if (sunElevation > -0.3) {
    // Dusk/dawn transition
    let t = smoothstep(-0.3, -0.1, sunElevation);
    skyColor = mix(nightColor, sunsetColor, t);
    horizonColor = mix(nightHorizon, sunsetHorizon, t);
    sunColor = mix(nightSun, sunsetSun, t);
  } else {
    // Full night
    skyColor = nightColor;
    horizonColor = nightHorizon;
    sunColor = nightSun;
  }
  
  // Blend sky and horizon based on ray direction
  var color = mix(horizonColor, skyColor, horizonDot);
  
  // Add sun/moon glow
  let sunGlow = pow(sunDot, 128.0) * 2.0 + pow(sunDot, 8.0) * 0.5;
  
  // Moon is dimmer but still visible
  let glowStrength = select(0.3, 1.0, sunElevation > -0.1); // Dim moon at night
  color += sunColor * sunGlow * glowStrength;
  
  // Add stars at night
  if (sunElevation < 0.0) {
    let starDensity = max(0.0, -sunElevation) * 0.5; // More stars when darker
    let starNoise = hash(rayDir.xz * 200.0);
    if (starNoise > 0.998) {
      color += vec3<f32>(1.0, 1.0, 0.9) * starDensity;
    }
  }
  
  return color;
}

// Get fog color based on time of day (smooth transitions)
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

// Apply atmospheric fog (exponential for natural falloff)
fn applyFog(color: vec3<f32>, distance: f32, rayDir: vec3<f32>, sunDir: vec3<f32>) -> vec3<f32> {
  // Exponential fog: density = 1 - exp(-distance * fogDensity)
  // This creates natural logarithmic falloff with minimal near-field fog
  let fogDensity = timeParams.fogDensity * 0.03; // Scale for distance in meters
  let fogFactor = 1.0 - exp(-distance * fogDensity);
  
  let fogColor = getFogColor(sunDir);
  
  return mix(color, fogColor, fogFactor);
}

// Soft shadow ray marching - traces toward sun with penumbra
fn softShadow(origin: vec3<f32>, lightDir: vec3<f32>) -> f32 {
  var shadow = 1.0;
  var voxelCoord = worldToVoxel(origin);
  
  let stepDir = vec3<i32>(
    select(-1, 1, lightDir.x > 0.0),
    select(-1, 1, lightDir.y > 0.0),
    select(-1, 1, lightDir.z > 0.0)
  );
  
  let tDelta = abs(vec3<f32>(VOXEL_SIZE) / lightDir);
  let voxelBoundary = vec3<f32>(voxelCoord + select(vec3<i32>(0), vec3<i32>(1), stepDir > vec3<i32>(0))) * VOXEL_SIZE;
  var tMax = (voxelBoundary - origin) / lightDir;
  
  // Shadow marching with penumbra accumulation
  let maxSteps = 16; // Fewer steps for performance
  var totalDist = 0.0;
  var minPenumbra = 1.0; // Track closest approach to blocker
  
  for (var i = 0; i < maxSteps; i++) {
    let currentDist = min(tMax.x, min(tMax.y, tMax.z));
    totalDist += currentDist;
    
    // If we've marched far enough, assume fully lit
    if (totalDist > 20.0) {
      break;
    }
    
    // Check if we hit solid terrain (not water)
    if (isVoxelSolid(voxelCoord) && !isVoxelWater(voxelCoord)) {
      // Accumulate penumbra based on distance to occluder
      let penumbra = smoothstep(0.0, 15.0, totalDist); // Smooth falloff over 15m
      minPenumbra = min(minPenumbra, mix(0.85, 1.0, penumbra)); // 85-100% lit
    }
    
    // Step to next voxel
    if (tMax.x < tMax.y) {
      if (tMax.x < tMax.z) {
        voxelCoord.x += stepDir.x;
        tMax.x += tDelta.x;
      } else {
        voxelCoord.z += stepDir.z;
        tMax.z += tDelta.z;
      }
    } else {
      if (tMax.y < tMax.z) {
        voxelCoord.y += stepDir.y;
        tMax.y += tDelta.y;
      } else {
        voxelCoord.z += stepDir.z;
        tMax.z += tDelta.z;
      }
    }
    
    // Bounds check
    if (voxelCoord.x < 0 || voxelCoord.x >= 512 ||
        voxelCoord.y < 0 || voxelCoord.y >= 512 ||
        voxelCoord.z < 0 || voxelCoord.z >= 512) {
      break;
    }
  }
  
  return minPenumbra;
}

// Calculate smooth terrain normal using height gradient
fn getTerrainNormal(voxelX: i32, voxelZ: i32) -> vec3<f32> {
  // Sample surrounding heights to calculate gradient
  let epsilon = 1.0; // Sample 1 voxel away
  
  let h0 = getTerrainHeight(voxelX, voxelZ);
  let hx = getTerrainHeight(voxelX + 1, voxelZ);
  let hz = getTerrainHeight(voxelX, voxelZ + 1);
  
  // Calculate gradient in voxel space
  let dx = (hx - h0) / epsilon;
  let dz = (hz - h0) / epsilon;
  
  // Normal = cross product of tangent vectors
  // tangentX = (1, dx, 0), tangentZ = (0, dz, 1)
  // normal = (-dx, 1, -dz) normalized
  return normalize(vec3<f32>(-dx * VOXEL_SIZE, 1.0, -dz * VOXEL_SIZE));
}

// Get material by block ID
fn getMaterial(blockId: u32) -> BlockMaterial {
  // Linear search through materials array
  for (var i = 0u; i < arrayLength(&materials); i++) {
    if (u32(materials[i].id) == blockId) {
      return materials[i];
    }
  }
  // Return default material if not found (grey)
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

// Calculate LOD scale dynamically based on resolution
fn getLODScale(lod: u32) -> f32 {
  var resolution: u32;
  if (lod == 0u) {
    resolution = params.lod0Res;  // 512
  } else if (lod == 1u) {
    resolution = params.lod1Res;  // 128 (default)
  } else if (lod == 2u) {
    resolution = params.lod2Res;  // 32 (default)
  } else {
    resolution = params.lod3Res;  // 8 (default)
  }
  
  // How many voxels does each texel represent?
  // LOD0 (512): 1 texel = 1 voxel
  // LOD1 (128): 1 texel = 4 voxels (512/128)
  // LOD2 (32):  1 texel = 16 voxels (512/32)
  // LOD3 (8):   1 texel = 64 voxels (512/8)
  let voxelsPerTexel = WORLD_VOXELS / f32(resolution);
  
  // Convert to meters
  return voxelsPerTexel * VOXEL_SIZE;
}

// Calculate step size for LOD (returns meters)
fn getLODStep(lod: u32) -> f32 {
  if (lod == 0u) {
    return VOXEL_SIZE; // Full voxel precision at LOD 0
  }
  return getLODScale(lod); // Step size = texel size for other LODs
}

// Simple hash function for noise
fn hash(p: vec2<f32>) -> f32 {
  let p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.13);
  let dot_p3 = dot(vec3<f32>(p3.x + p3.y, p3.y + p3.z, p3.z + p3.x), p3);
  return fract((dot_p3 + p3.x) * p3.y);
}

// 2D Perlin-like noise
fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  
  // Smooth interpolation
  let u = f * f * (3.0 - 2.0 * f);
  
  // Four corners
  let a = hash(i);
  let b = hash(i + vec2<f32>(1.0, 0.0));
  let c = hash(i + vec2<f32>(0.0, 1.0));
  let d = hash(i + vec2<f32>(1.0, 1.0));
  
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Multi-octave noise for water ripples
fn waterNoise(pos: vec2<f32>, time: f32) -> f32 {
  var value = 0.0;
  var amplitude = 1.0;
  var frequency = 1.0;
  
  // 3 octaves for detail
  for (var i = 0; i < 3; i++) {
    let p = pos * frequency + vec2<f32>(time * 0.3, time * 0.2) * frequency;
    value += noise(p) * amplitude;
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  
  return value * 2.0 - 1.0; // Range: -1 to 1
}

// Calculate animated surface normal based on animation parameters
fn getAnimatedNormal(worldPos: vec3<f32>, anim: Animation) -> vec3<f32> {
  let time = timeParams.time * anim.speed;
  let scale = anim.scale;
  let strength = anim.strength;
  let octaves = i32(anim.octaves);
  
  // Sample noise at position and nearby points for gradient
  let epsilon = 0.5;
  var h = 0.0;
  var hx = 0.0;
  var hz = 0.0;
  
  if (anim.animType < 0.5) { // Ripples
    h = waterNoise(worldPos.xz * scale, time) * strength;
    hx = waterNoise((worldPos.xz + vec2<f32>(epsilon, 0.0)) * scale, time) * strength;
    hz = waterNoise((worldPos.xz + vec2<f32>(0.0, epsilon)) * scale, time) * strength;
    
  } else if (anim.animType < 1.5) { // Flow
    let flowDir = vec2<f32>(anim.dirX, anim.dirY);
    h = noise((worldPos.xz + time * 10.0 * flowDir) * scale) * strength;
    hx = noise((worldPos.xz + vec2<f32>(epsilon, 0.0) + time * 10.0 * flowDir) * scale) * strength;
    hz = noise((worldPos.xz + vec2<f32>(0.0, epsilon) + time * 10.0 * flowDir) * scale) * strength;
    
  } else if (anim.animType < 2.5) { // Sway
    let phase = worldPos.x * scale * 0.5 + time * anim.speed * 3.14159;
    h = sin(phase) * strength;
    hx = sin((worldPos.x + epsilon) * scale * 0.5 + time * anim.speed * 3.14159) * strength;
    hz = h; // No Z variation for sway
    
  } else { // Shimmer
    h = noise(worldPos.xz * scale + vec2<f32>(time * 2.0)) * strength * 0.5;
    hx = noise((worldPos.xz + vec2<f32>(epsilon, 0.0)) * scale + vec2<f32>(time * 2.0)) * strength * 0.5;
    hz = noise((worldPos.xz + vec2<f32>(0.0, epsilon)) * scale + vec2<f32>(time * 2.0)) * strength * 0.5;
  }
  
  // Calculate gradient (tangent space)
  let dx = (hx - h) / epsilon;
  let dz = (hz - h) / epsilon;
  
  // Normal = (-dx, 1, -dz) normalized
  return normalize(vec3<f32>(-dx, 1.0, -dz));
}


// Schlick's approximation for Fresnel reflectance
// n1 = air (1.0), n2 = water (1.33)
fn fresnelSchlick(cosTheta: f32, n1: f32, n2: f32) -> f32 {
  var r0 = (n1 - n2) / (n1 + n2);
  r0 = r0 * r0;
  let oneMinusCos = 1.0 - cosTheta;
  return r0 + (1.0 - r0) * pow(oneMinusCos, 5.0);
}

// Heatmap color gradient (blue → green → yellow → red)
fn heatmap(value: f32, maxValue: f32) -> vec3<f32> {
  let t = clamp(value / maxValue, 0.0, 1.0);
  
  if (t < 0.25) {
    // Blue to cyan
    let s = t * 4.0;
    return vec3<f32>(0.0, s, 1.0);
  } else if (t < 0.5) {
    // Cyan to green
    let s = (t - 0.25) * 4.0;
    return vec3<f32>(0.0, 1.0, 1.0 - s);
  } else if (t < 0.75) {
    // Green to yellow
    let s = (t - 0.5) * 4.0;
    return vec3<f32>(s, 1.0, 0.0);
  } else {
    // Yellow to red
    let s = (t - 0.75) * 4.0;
    return vec3<f32>(1.0, 1.0 - s, 0.0);
  }
}

// Signed Distance Function for a box
fn sdBox(p: vec3<f32>, b: vec3<f32>) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// Get voxel coordinate from world position
fn worldToVoxel(worldPos: vec3<f32>) -> vec3<i32> {
  return vec3<i32>(floor(worldPos / VOXEL_SIZE));
}

// Get voxel center from voxel coordinate
fn voxelToWorld(voxelCoord: vec3<i32>) -> vec3<f32> {
  return (vec3<f32>(voxelCoord) + vec3<f32>(0.5)) * VOXEL_SIZE;
}

// Sample LOD heightmap at world position (returns height in meters, 0-256)
fn sampleHeightLOD(worldPos: vec2<f32>, lod: u32) -> f32 {
  var resolution: u32;
  
  if (lod == 0u) {
    resolution = params.lod0Res;
  } else if (lod == 1u) {
    resolution = params.lod1Res;
  } else if (lod == 2u) {
    resolution = params.lod2Res;
  } else {
    resolution = params.lod3Res;
  }
  
  let scale = getLODScale(lod);
  
  // Convert world position to texel coordinate
  let texelX = i32(worldPos.x / scale);
  let texelZ = i32(worldPos.y / scale);
  
  // Bounds check
  if (texelX < 0 || texelX >= i32(resolution) || texelZ < 0 || texelZ >= i32(resolution)) {
    return 256.0; // Out of bounds = max height
  }
  
  let idx = u32(texelZ * i32(resolution) + texelX);
  var normalizedHeight: f32;
  
  if (lod == 0u) {
    normalizedHeight = heightLOD0[idx];
  } else if (lod == 1u) {
    normalizedHeight = heightLOD1[idx];
  } else if (lod == 2u) {
    normalizedHeight = heightLOD2[idx];
  } else {
    normalizedHeight = heightLOD3[idx];
  }
  
  return normalizedHeight * 256.0; // Convert to meters (0-256)
}

// Sample heightmap at voxel coordinate (returns height in voxels, 0-256)
fn getTerrainHeight(voxelX: i32, voxelZ: i32) -> f32 {
  // Bounds check
  if (voxelX < 0 || voxelX >= 512 || voxelZ < 0 || voxelZ >= 512) {
    return 256.0; // Return max height for out of bounds (solid ceiling)
  }
  
  let idx = u32(voxelZ * 512 + voxelX);
  let normalizedHeight = heightLOD0[idx]; // 0.0 to 1.0
  return normalizedHeight * 256.0; // Direct mapping
}

// Sample water level at voxel coordinate (returns water height in voxels, 0-256)
fn getWaterLevel(voxelX: i32, voxelZ: i32) -> f32 {
  if (voxelX < 0 || voxelX >= 512 || voxelZ < 0 || voxelZ >= 512) {
    return 0.0;
  }
  
  let idx = u32(voxelZ * 512 + voxelX);
  // Water map: 0 = no water, >0 = water elevation (NO INVERSION)
  let level = waterMap[idx] * 256.0;
  // Safety clamp - water should never exceed terrain height limit
  return clamp(level, 0.0, 256.0);
}

// Sample block type at voxel coordinate
fn getBlockType(voxelX: i32, voxelZ: i32) -> u32 {
  if (voxelX < 0 || voxelX >= 512 || voxelZ < 0 || voxelZ >= 512) {
    return 0u; // Default block
  }
  
  let idx = u32(voxelZ * 512 + voxelX);
  return blocksMap[idx];
}

// Check if voxel is solid (terrain or water volume)
fn isVoxelSolid(voxelCoord: vec3<i32>) -> bool {
  let terrainHeight = getTerrainHeight(voxelCoord.x, voxelCoord.z);
  let waterLevel = getWaterLevel(voxelCoord.x, voxelCoord.z);
  let y = f32(voxelCoord.y);
  
  // 1. At or below terrain = solid terrain
  if (y <= terrainHeight) {
    return true;
  }
  
  // 2. Above terrain, check water
  if (waterLevel > 0.1) {
    // Water exists at this texel
    if (y <= waterLevel) {
      // Between terrain and water surface = water volume
      return true;
    }
    // Above water surface = air
    return false;
  }
  
  // 3. No water, above terrain = air
  return false;
}

// Check if voxel is water (not terrain)
fn isVoxelWater(voxelCoord: vec3<i32>) -> bool {
  let terrainHeight = getTerrainHeight(voxelCoord.x, voxelCoord.z);
  let waterLevel = getWaterLevel(voxelCoord.x, voxelCoord.z);
  let y = f32(voxelCoord.y);
  
  // Water only if: above terrain AND at/below water surface AND water exists
  return waterLevel > 0.1 && y > terrainHeight && y <= waterLevel;
}

// Calculate voxel face normal from ray direction
// Since LOD doesn't step on voxel boundaries, infer the face from ray direction
fn calculateVoxelFaceNormal(rayDir: vec3<f32>, voxelCoord: vec3<i32>) -> vec3<f32> {
  // For terrain heightmap, we almost always hit from above (top face)
  // Check if ray is going downward
  if (rayDir.y < 0.0) {
    // Hitting top face (from above)
    return vec3<f32>(0.0, 1.0, 0.0);
  }
  
  // If going mostly horizontal, determine X or Z face
  let absDir = abs(rayDir);
  
  if (absDir.x > absDir.z) {
    // Hit X face
    return vec3<f32>(-sign(rayDir.x), 0.0, 0.0);
  } else {
    // Hit Z face
    return vec3<f32>(0.0, 0.0, -sign(rayDir.z));
  }
}

// Hierarchical LOD ray marching using DDA at each level
fn raymarchLOD(rayOrigin: vec3<f32>, rayDir: vec3<f32>) -> vec3<f32> {
  var currentLOD = 3u; // Start with coarsest LOD
  var voxelSize = getLODStep(currentLOD);
  
  // Initialize DDA for current LOD level
  var voxelCoord = vec3<i32>(floor(rayOrigin / voxelSize));
  
  // Step direction for each axis
  let stepDir = vec3<i32>(
    select(-1, 1, rayDir.x > 0.0),
    select(-1, 1, rayDir.y > 0.0),
    select(-1, 1, rayDir.z > 0.0)
  );
  
  // tDelta: how far along ray to move 1 voxel in each axis
  var tDelta = abs(vec3<f32>(voxelSize) / rayDir);
  
  // tMax: distance along ray to next voxel boundary in each axis
  let voxelBoundary = vec3<f32>(voxelCoord + select(vec3<i32>(0), vec3<i32>(1), stepDir > vec3<i32>(0))) * voxelSize;
  var tMax = (voxelBoundary - rayOrigin) / rayDir;
  
  // Track which face we hit
  var normal = vec3<f32>(0.0, 1.0, 0.0);
  
  let maxSteps = 500;
  let worldSize = WORLD_VOXELS * VOXEL_SIZE;
  
  // March through voxels using DDA
  for (var i = 0; i < maxSteps; i++) {
    // Bounds check
    let worldPos = vec3<f32>(voxelCoord) * voxelSize;
    if (worldPos.x < 0.0 || worldPos.x > worldSize || 
        worldPos.z < 0.0 || worldPos.z > worldSize || 
        worldPos.y > 256.0 || worldPos.y < 0.0) {
      break; // Out of world bounds
    }
    
    // Sample terrain at current LOD "voxel"
    let worldPosXZ = worldPos.xz;
    let chunkHeight = sampleHeightLOD(worldPosXZ, currentLOD);
    
    // Check if this chunk contains terrain
    let chunkHasTerrainPotential = (worldPos.y <= chunkHeight);
    
    if (chunkHasTerrainPotential) {
      // This chunk might contain terrain
      if (currentLOD == 0u) {
        // At finest LOD - do actual voxel collision
        let actualVoxelCoord = vec3<i32>(floor(worldPos / VOXEL_SIZE));
        
        if (isVoxelSolid(actualVoxelCoord)) {
          // HIT!
          
          // Debug heatmaps
          if (camera.debugStepCount > 0.5) {
            // Blue = few steps, Red = many steps
            return heatmap(f32(i), 500.0);
          }
          if (camera.debugDistance > 0.5) {
            // Blue = near, Red = far
            let travelDist = min(tMax.x, min(tMax.y, tMax.z));
            return heatmap(travelDist, 500.0);
          }
          
          // Calculate shading and return color
          var baseColor = vec3<f32>(0.0);
          
          if (isVoxelWater(actualVoxelCoord)) {
            if (camera.showWater > 0.5) {
              baseColor = vec3<f32>(0.2, 0.4, 0.8);
            } else {
              // Skip water, continue DDA
              continue;
            }
          } else {
            if (camera.showTerrain > 0.5) {
              let blockType = getBlockType(actualVoxelCoord.x, actualVoxelCoord.z);
              switch (blockType) {
                case 0u: { baseColor = vec3<f32>(0.93, 0.79, 0.69); } // Sand
                case 1u: { baseColor = vec3<f32>(0.27, 0.71, 0.27); } // Grass
                case 2u: { baseColor = vec3<f32>(0.2, 0.5, 0.2); }    // Forest
                case 3u: { baseColor = vec3<f32>(0.5, 0.5, 0.5); }    // Stone
                case 4u: { baseColor = vec3<f32>(1.0, 1.0, 1.0); }    // Snow
                case 5u: { baseColor = vec3<f32>(0.8, 0.7, 0.5); }    // Desert
                case 6u: { baseColor = vec3<f32>(0.6, 0.4, 0.2); }    // Dirt
                default: { baseColor = vec3<f32>(0.5, 0.5, 0.5); }    // Unknown
              }
            } else {
              // Terrain disabled, continue DDA
              continue;
            }
          }
          
          // Debug: Visualize normals as colors
          if (camera.debugNormals > 0.5) {
            // Map normal from [-1,1] to [0,1] RGB
            return (normal + vec3<f32>(1.0)) * 0.5;
          }
          
          let sunDir = normalize(vec3<f32>(0.5, 0.8, 0.3));
          let diffuse = max(0.0, dot(normal, sunDir));
          let ambient = 0.3;
          let lighting = ambient + diffuse * 0.7;
          
          // Distance fog
          let fogColor = vec3<f32>(0.5, 0.6, 0.7);
          let fogStart = 200.0;
          let fogEnd = 800.0;
          let travelDist = min(tMax.x, min(tMax.y, tMax.z));
          let fogFactor = clamp((travelDist - fogStart) / (fogEnd - fogStart), 0.0, 1.0);
          
          return mix(baseColor * lighting, fogColor, fogFactor);
        }
        // LOD 0 but not solid - fall through to DDA step
      } else {
        // At coarser LOD - drill down to finer resolution
        currentLOD = currentLOD - 1u;
        voxelSize = getLODStep(currentLOD);
        
        // Calculate current ray position for reinitialization
        let currentT = min(tMax.x, min(tMax.y, tMax.z));
        let currentRayPos = rayOrigin + rayDir * currentT;
        
        // Reinitialize DDA at finer resolution from current position
        voxelCoord = vec3<i32>(floor(currentRayPos / voxelSize));
        tDelta = abs(vec3<f32>(voxelSize) / rayDir);
        let voxelBoundary2 = vec3<f32>(voxelCoord + select(vec3<i32>(0), vec3<i32>(1), stepDir > vec3<i32>(0))) * voxelSize;
        tMax = (voxelBoundary2 - currentRayPos) / rayDir + currentT;
        continue; // Recheck at finer LOD
      }
    }
    
    // DDA step: move to next voxel boundary at current LOD
    if (tMax.x < tMax.y) {
      if (tMax.x < tMax.z) {
        voxelCoord.x += stepDir.x;
        tMax.x += tDelta.x;
        normal = vec3<f32>(-f32(stepDir.x), 0.0, 0.0);
      } else {
        voxelCoord.z += stepDir.z;
        tMax.z += tDelta.z;
        normal = vec3<f32>(0.0, 0.0, -f32(stepDir.z));
      }
    } else {
      if (tMax.y < tMax.z) {
        voxelCoord.y += stepDir.y;
        tMax.y += tDelta.y;
        normal = vec3<f32>(0.0, -f32(stepDir.y), 0.0);
      } else {
        voxelCoord.z += stepDir.z;
        tMax.z += tDelta.z;
        normal = vec3<f32>(0.0, 0.0, -f32(stepDir.z));
      }
    }
  }
  
  // Sky color
  let horizonColor = vec3<f32>(0.5, 0.6, 0.7);
  let zenithColor = vec3<f32>(0.3, 0.5, 0.8);
  let t_sky = max(0.0, rayDir.y);
  return mix(horizonColor, zenithColor, t_sky);
}

// Simplified reflection ray tracer (max 128 steps for performance)
fn traceReflection(rayOrigin: vec3<f32>, rayDir: vec3<f32>) -> vec3<f32> {
  var voxelCoord = worldToVoxel(rayOrigin);
  
  let stepDir = vec3<i32>(
    select(-1, 1, rayDir.x > 0.0),
    select(-1, 1, rayDir.y > 0.0),
    select(-1, 1, rayDir.z > 0.0)
  );
  
  let tDelta = abs(vec3<f32>(VOXEL_SIZE) / rayDir);
  let voxelBoundary = vec3<f32>(voxelCoord + select(vec3<i32>(0), vec3<i32>(1), stepDir > vec3<i32>(0))) * VOXEL_SIZE;
  var tMax = (voxelBoundary - rayOrigin) / rayDir;
  var normal = vec3<f32>(0.0);
  
  let maxSteps = 128; // Limited for performance
  
  for (var i = 0; i < maxSteps; i++) {
    // Hit solid terrain (not water)?
    if (isVoxelSolid(voxelCoord) && !isVoxelWater(voxelCoord)) {
      let blockType = getBlockType(voxelCoord.x, voxelCoord.z);
      let material = getMaterial(blockType);
      let baseColor = vec3<f32>(material.colorR, material.colorG, material.colorB);
      
      // Dynamic sun lighting (same as main render)
      let sunDir = getSunDirection(timeParams.timeOfDay);
      let diffuse = max(dot(normal, sunDir), 0.0);
      
      // Smooth ambient light transitions
      let sunElevation = sunDir.y;
      var ambient: f32;
      if (sunElevation > 0.3) {
        ambient = 0.5; // Day
      } else if (sunElevation > -0.1) {
        ambient = mix(0.15, 0.5, smoothstep(-0.1, 0.3, sunElevation)); // Sunset
      } else {
        ambient = mix(0.03, 0.15, smoothstep(-0.3, -0.1, sunElevation)); // Night
      }
      
      return baseColor * (ambient + diffuse * (1.0 - ambient));
    }
    
    // Step to next voxel
    if (tMax.x < tMax.y) {
      if (tMax.x < tMax.z) {
        voxelCoord.x += stepDir.x;
        tMax.x += tDelta.x;
        normal = vec3<f32>(-f32(stepDir.x), 0.0, 0.0);
      } else {
        voxelCoord.z += stepDir.z;
        tMax.z += tDelta.z;
        normal = vec3<f32>(0.0, 0.0, -f32(stepDir.z));
      }
    } else {
      if (tMax.y < tMax.z) {
        voxelCoord.y += stepDir.y;
        tMax.y += tDelta.y;
        normal = vec3<f32>(0.0, -f32(stepDir.y), 0.0);
      } else {
        voxelCoord.z += stepDir.z;
        tMax.z += tDelta.z;
        normal = vec3<f32>(0.0, 0.0, -f32(stepDir.z));
      }
    }
    
    // Bounds check
    if (voxelCoord.x < 0 || voxelCoord.x >= 512 ||
        voxelCoord.y < 0 || voxelCoord.y >= 512 ||
        voxelCoord.z < 0 || voxelCoord.z >= 512) {
      break;
    }
  }
  
  // Hit nothing - return sky with sun
  let sunDir = getSunDirection(timeParams.timeOfDay);
  return getSkyColor(rayDir, sunDir);
}

// DDA voxel traversal ray marcher with shading and water transparency
fn raymarch(rayOrigin: vec3<f32>, rayDir: vec3<f32>) -> vec3<f32> {
  // Initialize DDA
  var voxelCoord = worldToVoxel(rayOrigin);
  
  // Step direction (which way to step in each axis)
  let stepDir = vec3<i32>(
    select(-1, 1, rayDir.x > 0.0),
    select(-1, 1, rayDir.y > 0.0),
    select(-1, 1, rayDir.z > 0.0)
  );
  
  // Calculate tDelta (how far along ray to move 1 voxel in each axis)
  let tDelta = abs(vec3<f32>(VOXEL_SIZE) / rayDir);
  
  // Calculate tMax (distance along ray to next voxel boundary in each axis)
  let voxelBoundary = vec3<f32>(voxelCoord + select(vec3<i32>(0), vec3<i32>(1), stepDir > vec3<i32>(0))) * VOXEL_SIZE;
  var tMax = (voxelBoundary - rayOrigin) / rayDir;
  
  // Track which face we hit
  var normal = vec3<f32>(0.0);
  
  // Water tracking
  var inWater = false;
  var waterStartDist = 0.0;
  var waterSurfaceNormal = vec3<f32>(0.0, 1.0, 0.0);
  var waterSurfacePos = vec3<f32>(0.0);
  
  let maxSteps = 1024; // Increased for water traversal
  
  for (var i = 0; i < maxSteps; i++) {
    // Debug mode: Visualize water map values
    if (camera.debugWaterValues > 0.5) {
      let terrainHeight = getTerrainHeight(voxelCoord.x, voxelCoord.z);
      let y = f32(voxelCoord.y);
      
      // Hit terrain or any solid - show RAW water map value
      if (y <= terrainHeight) {
        // RAW water value from map (0.0 to 1.0)
        let waterValue = waterMap[u32(voxelCoord.z * 512 + voxelCoord.x)];
        
        // Color code it:
        // Black = 0 (no water)
        // Red = 0.01-0.4 (below/at sea level)
        // Yellow = 0.4-0.7 (above sea level)
        // White = 0.7-1.0 (very high water)
        if (waterValue < 0.01) {
          return vec3<f32>(0.0, 0.0, 0.0); // Black = no water
        } else if (waterValue < 0.4) {
          return vec3<f32>(1.0, 0.0, 0.0); // Red = low/ocean
        } else if (waterValue < 0.7) {
          return vec3<f32>(1.0, 1.0, 0.0); // Yellow = medium
        } else {
          return vec3<f32>(1.0, 1.0, 1.0); // White = high (ERROR!)
        }
      }
    }
    
    // Current distance traveled
    let currentDist = min(tMax.x, min(tMax.y, tMax.z));
    
    // Check if we're entering water
    if (!inWater && isVoxelWater(voxelCoord) && camera.showWater > 0.5) {
      inWater = true;
      waterStartDist = currentDist;
      waterSurfacePos = rayOrigin + rayDir * currentDist;
      
      // Get water block material to check for animation
      let waterBlockType = 6u; // Water block ID (could also query from map)
      let waterMaterial = getMaterial(waterBlockType);
      
      // Calculate perturbed water surface normal
      if (waterMaterial.animationId >= 0.0) {
        // Use animation from material
        let animIndex = i32(waterMaterial.animationId);
        let anim = animations[animIndex];
        waterSurfaceNormal = getAnimatedNormal(waterSurfacePos, anim);
      } else {
        // No animation assigned - use flat normal
        waterSurfaceNormal = vec3<f32>(0.0, 1.0, 0.0);
      }
      
      // Continue through water
      continue;
    }
    
    // Check if we hit solid terrain
    if (isVoxelSolid(voxelCoord) && !isVoxelWater(voxelCoord)) {
      if (camera.showTerrain > 0.5) {
        let blockType = getBlockType(voxelCoord.x, voxelCoord.z);
        let material = getMaterial(blockType);
        var baseColor = vec3<f32>(material.colorR, material.colorG, material.colorB);
        
        if (camera.debugStepCount > 0.5) {
          return heatmap(f32(i), 500.0);
        }
        if (camera.debugDistance > 0.5) {
          return heatmap(currentDist, 500.0);
        }
        if (camera.debugNormals > 0.5) {
          return (normal + vec3<f32>(1.0)) * 0.5;
        }
        
        // Dynamic sun lighting based on time of day
        let sunDir = getSunDirection(timeParams.timeOfDay);
        
        // Use smooth terrain normal instead of voxel face normal
        let terrainNormal = getTerrainNormal(voxelCoord.x, voxelCoord.z);
        
        // Soft shadows - march toward sun to check occlusion
        var shadow = 1.0;
        let hitPos = rayOrigin + rayDir * currentDist;
        shadow = softShadow(hitPos + terrainNormal * 0.1, sunDir);
        
        // Diffuse lighting with smooth falloff
        let rawDiffuse = max(dot(terrainNormal, sunDir), 0.0);
        let diffuse = rawDiffuse * shadow;
        
        // Smooth ambient light transitions (increased to fill shadows)
        let sunElevation = sunDir.y;
        var ambient: f32;
        if (sunElevation > 0.3) {
          ambient = 0.55; // Day
        } else if (sunElevation > -0.1) {
          ambient = mix(0.25, 0.55, smoothstep(-0.1, 0.3, sunElevation)); // Sunset
        } else {
          ambient = mix(0.05, 0.25, smoothstep(-0.3, -0.1, sunElevation)); // Night
        }
        
        // Sky ambient fills in shadow crevices (independent of sun direction)
        let skyLight = 0.2 * (1.0 - max(dot(terrainNormal, vec3<f32>(0.0, -1.0, 0.0)), 0.0)); // Less light in downward faces
        
        let lighting = min(ambient + skyLight + diffuse * 0.6, 1.0);
        
        // Apply emissive
        var finalColor = baseColor * lighting;
        if (material.emissive > 0.0) {
          finalColor = mix(finalColor, baseColor, material.emissive);
        }
        
        // Apply water fog if we traveled through water
        if (inWater) {
          let waterDist = currentDist - waterStartDist;
          let waterColor = vec3<f32>(0.1, 0.4, 0.6); // Darker blue-green water fog
          let waterFogDensity = 0.15; // How quickly water fog obscures (higher = thicker)
          let waterFogFactor = 1.0 - exp(-waterDist * waterFogDensity);
          finalColor = mix(finalColor, waterColor, waterFogFactor);
          
          // Fresnel-based reflection from water surface
          let viewDir = -rayDir;
          let cosTheta = abs(dot(viewDir, waterSurfaceNormal));
          
          // Schlick's Fresnel for air→water interface (n1=1.0, n2=1.33)
          let fresnel = fresnelSchlick(cosTheta, 1.0, 1.33);
          
          // Trace reflection ray (terrain + sky)
          let reflectDir = reflect(rayDir, waterSurfaceNormal);
          let reflectionColor = traceReflection(waterSurfacePos + reflectDir * 0.1, reflectDir);
          
          // Blend reflection based on Fresnel
          // At grazing angles (low view): fresnel ≈ 1.0 (mirror-like)
          // At steep angles (looking down): fresnel ≈ 0.02 (mostly transparent)
          finalColor = mix(finalColor, reflectionColor, fresnel);
        }
        
        // Atmospheric fog (dynamic based on time of day)
        finalColor = applyFog(finalColor, currentDist, rayDir, sunDir);
        
        return finalColor;
      }
    }
    
    // Check if we exited water (went into air)
    if (inWater && !isVoxelWater(voxelCoord)) {
      inWater = false;
    }
    
    // Step to next voxel (choose axis with smallest tMax)
    if (tMax.x < tMax.y) {
      if (tMax.x < tMax.z) {
        voxelCoord.x += stepDir.x;
        tMax.x += tDelta.x;
        normal = vec3<f32>(-f32(stepDir.x), 0.0, 0.0); // X face
      } else {
        voxelCoord.z += stepDir.z;
        tMax.z += tDelta.z;
        normal = vec3<f32>(0.0, 0.0, -f32(stepDir.z)); // Z face
      }
    } else {
      if (tMax.y < tMax.z) {
        voxelCoord.y += stepDir.y;
        tMax.y += tDelta.y;
        normal = vec3<f32>(0.0, -f32(stepDir.y), 0.0); // Y face
      } else {
        voxelCoord.z += stepDir.z;
        tMax.z += tDelta.z;
        normal = vec3<f32>(0.0, 0.0, -f32(stepDir.z)); // Z face
      }
    }
    
    // Bounds check (512x512x256 voxel grid)
    if (voxelCoord.x < 0 || voxelCoord.x >= 512 ||
        voxelCoord.y < 0 || voxelCoord.y >= 512 ||
        voxelCoord.z < 0 || voxelCoord.z >= 512) {
      break;
    }
  }
  
  // Missed - return sky color
  let sunDir = getSunDirection(timeParams.timeOfDay);
  var skyColor = getSkyColor(rayDir, sunDir);
  
  // Apply water fog if ray passed through water
  if (inWater) {
    let maxDist = min(tMax.x, min(tMax.y, tMax.z));
    let waterDist = maxDist - waterStartDist;
    let waterColor = vec3<f32>(0.1, 0.4, 0.6);
    let waterFogFactor = 1.0 - exp(-waterDist * 0.15);
    skyColor = mix(skyColor, waterColor, waterFogFactor);
  }
  
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
  
  // DEBUG: Visualize UV coverage (should see gradient)
  // let uv = vec2<f32>(pixelCoord) / vec2<f32>(texSize);
  // textureStore(outputTexture, pixelCoord, vec4<f32>(uv.x, uv.y, 0.0, 1.0));
  // return;
  
  // Generate ray from camera through pixel
  let uv = (vec2<f32>(pixelCoord) + vec2<f32>(0.5)) / vec2<f32>(texSize);
  // Flip Y to match canvas orientation
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, -(uv.y * 2.0 - 1.0));
  
  let rayDir = normalize(
    camera.forward +
    camera.right * ndc.x * tan(camera.fov * 0.5) * camera.aspect +
    camera.up * ndc.y * tan(camera.fov * 0.5)
  );
  
  // Ray march - choose algorithm based on debug flag
  var color: vec3<f32>;
  if (camera.useLOD > 0.5) {
    color = raymarchLOD(camera.position, rayDir);
  } else {
    color = raymarch(camera.position, rayDir);
  }
  
  // Write to output texture
  textureStore(outputTexture, pixelCoord, vec4<f32>(color, 1.0));
}
