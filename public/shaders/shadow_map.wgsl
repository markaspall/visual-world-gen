/**
 * Shadow Map Shader
 * 
 * Renders scene depth from the sun's perspective.
 * Creates a 2048x2048 depth texture for shadow mapping.
 */

struct Camera {
  view: mat4x4<f32>,
  projection: mat4x4<f32>,
}

@group(0) @binding(0) var<uniform> shadowCamera: Camera;

struct VertexInput {
  @location(0) position: vec3<f32>,
}

struct VertexOutput {
  @builtin(position) clipPosition: vec4<f32>,
}

@vertex
fn vertexMain(in: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  
  // Transform to shadow camera space (from sun's POV)
  let worldPos = vec4<f32>(in.position, 1.0);
  out.clipPosition = shadowCamera.projection * shadowCamera.view * worldPos;
  
  return out;
}

// No fragment shader needed - we only care about depth!
// WebGPU automatically writes depth to the depth buffer
