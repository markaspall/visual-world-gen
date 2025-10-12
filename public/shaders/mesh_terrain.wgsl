/**
 * Mesh Terrain Shader
 * 
 * Renders terrain as triangle meshes with:
 * - Day/night cycle (same as ray marcher)
 * - Exponential fog (same algorithm)
 * - Smooth lighting
 * - Material support
 */

// ===================================
// UNIFORMS
// ===================================

struct Camera {
  view: mat4x4<f32>,
  projection: mat4x4<f32>,
}

struct TimeParams {
  time: f32,
  timeOfDay: f32,      // 0-1 (0=midnight, 0.25=sunrise, 0.5=noon, 0.75=sunset)
  fogDistance: f32,    // Not used with exponential fog
  fogDensity: f32,     // Exponential fog strength
}

struct AnimationParams {
  waveFrequency: f32,  // Actually 'scale' from editor (0.15)
  waveAmplitude: f32,  // Actually 'strength' from editor (0.08)
  waveSpeed: f32,      // 'speed' from editor (0.5)
  wavePhase: f32,      // phase offset
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> timeParams: TimeParams;
@group(0) @binding(2) var shadowMap: texture_depth_2d;
@group(0) @binding(3) var shadowSampler: sampler_comparison;
@group(0) @binding(4) var<uniform> animParams: AnimationParams;

// ===================================
// VERTEX SHADER
// ===================================

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec3<f32>,
  @location(3) materialId: u32,
}

struct VertexOutput {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) worldPosition: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec3<f32>,
  @location(3) viewDistance: f32,
}

@vertex
fn vertexMain(in: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  
  var position = in.position;
  
  // Check if this vertex is water (high bit set in materialId)
  let isWater = (in.materialId & 0x80000000u) != 0u;
  
  // Apply water animation (sine wave) - Using editor parameters!
  if (isWater) {
    // Animation parameters from SurfaceAnimation node (matches ray marcher)
    // animParams: [scale, strength, speed, phase]
    let scale = animParams.waveFrequency;    // Editor's 'scale' (0.15)
    let strength = animParams.waveAmplitude; // Editor's 'strength' (0.08)
    let speed = animParams.waveSpeed;        // Editor's 'speed' (0.5)
    let phase = animParams.wavePhase;
    
    // Convert to wave frequency (scale affects wavelength)
    let freq = scale * 20.0; // scale=0.15 -> freq=3.0
    
    // Two overlapping sine waves for natural water motion
    let wave1 = sin(position.x * freq + timeParams.time * speed * 2.0 + phase);
    let wave2 = cos(position.z * freq * 0.7 + timeParams.time * speed * 1.6);
    
    // Map waves from [-1,1] to [0,-1] so ripples only go DOWN (not above water level)
    // This keeps the water surface at or below its designated elevation
    let wave1Down = (wave1 - 1.0) * 0.5; // Range: -1 to 0
    let wave2Down = (wave2 - 1.0) * 0.5; // Range: -1 to 0
    
    // Apply wave displacement using editor's strength value
    position.y += (wave1Down + wave2Down) * strength;
  }
  
  // Transform position to clip space
  let worldPos = vec4<f32>(position, 1.0);
  out.clipPosition = camera.projection * camera.view * worldPos;
  
  // Pass world position for lighting
  out.worldPosition = position;
  
  // Pass interpolated normal (already smooth from mesh builder)
  out.normal = in.normal;
  
  // Pass vertex color
  out.color = in.color;
  
  // Calculate view distance for fog
  // Extract camera position from view matrix (inverse of translation)
  let cameraPos = vec3<f32>(
    -(camera.view[3][0] * camera.view[0][0] + camera.view[3][1] * camera.view[1][0] + camera.view[3][2] * camera.view[2][0]),
    -(camera.view[3][0] * camera.view[0][1] + camera.view[3][1] * camera.view[1][1] + camera.view[3][2] * camera.view[2][1]),
    -(camera.view[3][0] * camera.view[0][2] + camera.view[3][1] * camera.view[1][2] + camera.view[3][2] * camera.view[2][2])
  );
  out.viewDistance = length(cameraPos - position);
  
  return out;
}

// ===================================
// FRAGMENT SHADER
// ===================================

// Calculate sun direction from time of day (same as ray marcher)
fn getSunDirection(timeOfDay: f32) -> vec3<f32> {
  // Sun moves in a circular arc
  // timeOfDay: 0=midnight, 0.25=sunrise, 0.5=noon, 0.75=sunset
  let angle = timeOfDay * 2.0 * 3.14159265359;
  
  // Sun elevation: high at noon (0.5), low at midnight (0.0)
  let elevation = sin(angle);
  
  // Sun azimuth: rotates around
  let azimuth = cos(angle);
  
  return normalize(vec3<f32>(azimuth, elevation, 0.3));
}

// Get sky color based on sun position (same as ray marcher)
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
  let nightSun = vec3<f32>(0.8, 0.8, 0.9);
  
  // Smooth transitions
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
  let glowStrength = select(0.3, 1.0, sunElevation > -0.1);
  color += sunColor * sunGlow * glowStrength;
  
  return color;
}

// Get fog color based on time of day (same as ray marcher)
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

// Apply exponential fog (same as ray marcher)
fn applyFog(color: vec3<f32>, distance: f32, sunDir: vec3<f32>) -> vec3<f32> {
  // Exponential fog: density = 1 - exp(-distance * fogDensity)
  let fogDensity = timeParams.fogDensity * 0.03;
  let fogFactor = 1.0 - exp(-distance * fogDensity);
  
  let fogColor = getFogColor(sunDir);
  
  return mix(color, fogColor, fogFactor);
}

// Calculate shadow using PCF (Percentage Closer Filtering)
fn calculateShadow(worldPos: vec3<f32>, normal: vec3<f32>, sunDir: vec3<f32>) -> f32 {
  // Simple shadow mapping approach:
  // For now, use a simple distance-based soft shadow from sun direction
  // This is a simplified version - proper shadow mapping would use shadow camera matrix
  
  // Bias based on surface angle to sun (prevents shadow acne)
  let bias = max(0.005 * (1.0 - dot(normal, sunDir)), 0.001);
  
  // For this simplified version, we'll use a percentage-based shadow
  // based on how aligned the surface is with the sun
  let lightAlignment = max(dot(normal, sunDir), 0.0);
  
  // Soft shadow based on surface orientation
  // This is a placeholder - will be replaced with actual shadow map sampling
  return mix(0.3, 1.0, lightAlignment); // 30% shadow to 100% lit
}

// Fresnel approximation (Schlick's approximation)
fn fresnel(cosTheta: f32, ior: f32) -> f32 {
  let r0 = ((1.0 - ior) / (1.0 + ior)) * ((1.0 - ior) / (1.0 + ior));
  return r0 + (1.0 - r0) * pow(1.0 - cosTheta, 5.0);
}

@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4<f32> {
  // Sun direction from time of day
  let sunDir = getSunDirection(timeParams.timeOfDay);
  
  // Normalize interpolated normal
  let normal = normalize(in.normal);
  
  // Calculate shadow factor
  let shadowFactor = calculateShadow(in.worldPosition, normal, sunDir);
  
  // Diffuse lighting (with shadows)
  let diffuse = max(dot(normal, sunDir), 0.0) * shadowFactor;
  
  // Smooth ambient light transitions (same as ray marcher)
  let sunElevation = sunDir.y;
  var ambient: f32;
  if (sunElevation > 0.3) {
    ambient = 0.55; // Day
  } else if (sunElevation > -0.1) {
    ambient = mix(0.25, 0.55, smoothstep(-0.1, 0.3, sunElevation)); // Sunset
  } else {
    ambient = mix(0.05, 0.25, smoothstep(-0.3, -0.1, sunElevation)); // Night
  }
  
  // Sky ambient fills in shadow crevices (same as ray marcher)
  let skyLight = 0.2 * (1.0 - max(dot(normal, vec3<f32>(0.0, -1.0, 0.0)), 0.0));
  
  // Combined lighting (with soft shadows!)
  let lighting = min(ambient + skyLight + diffuse * 0.6, 1.0);
  
  var color = in.color * lighting;
  
  // Water transparency and reflections
  // Extract camera position for view direction
  let cameraPos = vec3<f32>(
    -(camera.view[3][0] * camera.view[0][0] + camera.view[3][1] * camera.view[1][0] + camera.view[3][2] * camera.view[2][0]),
    -(camera.view[3][0] * camera.view[0][1] + camera.view[3][1] * camera.view[1][1] + camera.view[3][2] * camera.view[2][1]),
    -(camera.view[3][0] * camera.view[0][2] + camera.view[3][1] * camera.view[1][2] + camera.view[3][2] * camera.view[2][2])
  );
  
  let viewDir = normalize(cameraPos - in.worldPosition);
  let cosTheta = max(dot(viewDir, normal), 0.0);
  
  // Calculate Fresnel for water (IOR = 1.33)
  let fresnelFactor = fresnel(cosTheta, 1.33);
  
  // Reflection direction
  let reflectDir = reflect(-viewDir, normal);
  
  // Sample sky color for reflection
  let skyReflection = getSkyColor(reflectDir, sunDir);
  
  var alpha = 1.0;
  
  // Check if this is water (check for blue-ish color as proxy)
  // Water has high blue component, low red
  if (in.color.b > 0.5 && in.color.r < 0.5) {
    // Water: blend base color with sky reflection using Fresnel
    color = mix(color, skyReflection * lighting, fresnelFactor * 0.3); // 0.3 = reflectivity from material
    alpha = 0.85; // 0.2 transparency from material (1.0 - 0.8)
  }
  
  // Apply exponential fog
  color = applyFog(color, in.viewDistance, sunDir);
  
  return vec4<f32>(color, alpha);
}
