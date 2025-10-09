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

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> timeParams: TimeParams;

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
  
  // Transform position to clip space
  let worldPos = vec4<f32>(in.position, 1.0);
  out.clipPosition = camera.projection * camera.view * worldPos;
  
  // Pass world position for lighting
  out.worldPosition = in.position;
  
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
  out.viewDistance = length(cameraPos - in.position);
  
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

@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4<f32> {
  // Sun direction from time of day
  let sunDir = getSunDirection(timeParams.timeOfDay);
  
  // Normalize interpolated normal
  let normal = normalize(in.normal);
  
  // Diffuse lighting
  let diffuse = max(dot(normal, sunDir), 0.0);
  
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
  
  // Combined lighting (same formula as ray marcher)
  let lighting = min(ambient + skyLight + diffuse * 0.6, 1.0);
  
  var color = in.color * lighting;
  
  // Apply exponential fog
  color = applyFog(color, in.viewDistance, sunDir);
  
  return vec4<f32>(color, 1.0);
}
