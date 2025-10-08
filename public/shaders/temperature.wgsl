struct Params {
  resolution: u32,
  seed: u32,
  frequency: f32,
  octaves: u32,
  persistence: f32,
  lacunarity: f32,
  scale: f32,
  elevationInfluence: f32,
  latitudeInfluence: f32,
  padding: u32,
  padding2: u32,
  padding3: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> heightMap: array<f32>;
@group(0) @binding(2) var<storage, read_write> output: array<f32>;

// Perlin noise permutation table
const P: array<u32, 512> = array<u32, 512>(
  151u,160u,137u,91u,90u,15u,131u,13u,201u,95u,96u,53u,194u,233u,7u,225u,140u,36u,103u,30u,69u,142u,
  8u,99u,37u,240u,21u,10u,23u,190u,6u,148u,247u,120u,234u,75u,0u,26u,197u,62u,94u,252u,219u,203u,117u,
  35u,11u,32u,57u,177u,33u,88u,237u,149u,56u,87u,174u,20u,125u,136u,171u,168u,68u,175u,74u,165u,71u,
  134u,139u,48u,27u,166u,77u,146u,158u,231u,83u,111u,229u,122u,60u,211u,133u,230u,220u,105u,92u,41u,
  55u,46u,245u,40u,244u,102u,143u,54u,65u,25u,63u,161u,1u,216u,80u,73u,209u,76u,132u,187u,208u,89u,
  18u,169u,200u,196u,135u,130u,116u,188u,159u,86u,164u,100u,109u,198u,173u,186u,3u,64u,52u,217u,226u,
  250u,124u,123u,5u,202u,38u,147u,118u,126u,255u,82u,85u,212u,207u,206u,59u,227u,47u,16u,58u,17u,182u,
  189u,28u,42u,223u,183u,170u,213u,119u,248u,152u,2u,44u,154u,163u,70u,221u,153u,101u,155u,167u,43u,
  172u,9u,129u,22u,39u,253u,19u,98u,108u,110u,79u,113u,224u,232u,178u,185u,112u,104u,218u,246u,97u,
  228u,251u,34u,242u,193u,238u,210u,144u,12u,191u,179u,162u,241u,81u,51u,145u,235u,249u,14u,239u,
  107u,49u,192u,214u,31u,181u,199u,106u,157u,184u,84u,204u,176u,115u,121u,50u,45u,127u,4u,150u,254u,
  138u,236u,205u,93u,222u,114u,67u,29u,24u,72u,243u,141u,128u,195u,78u,66u,215u,61u,156u,180u,
  151u,160u,137u,91u,90u,15u,131u,13u,201u,95u,96u,53u,194u,233u,7u,225u,140u,36u,103u,30u,69u,142u,
  8u,99u,37u,240u,21u,10u,23u,190u,6u,148u,247u,120u,234u,75u,0u,26u,197u,62u,94u,252u,219u,203u,117u,
  35u,11u,32u,57u,177u,33u,88u,237u,149u,56u,87u,174u,20u,125u,136u,171u,168u,68u,175u,74u,165u,71u,
  134u,139u,48u,27u,166u,77u,146u,158u,231u,83u,111u,229u,122u,60u,211u,133u,230u,220u,105u,92u,41u,
  55u,46u,245u,40u,244u,102u,143u,54u,65u,25u,63u,161u,1u,216u,80u,73u,209u,76u,132u,187u,208u,89u,
  18u,169u,200u,196u,135u,130u,116u,188u,159u,86u,164u,100u,109u,198u,173u,186u,3u,64u,52u,217u,226u,
  250u,124u,123u,5u,202u,38u,147u,118u,126u,255u,82u,85u,212u,207u,206u,59u,227u,47u,16u,58u,17u,182u,
  189u,28u,42u,223u,183u,170u,213u,119u,248u,152u,2u,44u,154u,163u,70u,221u,153u,101u,155u,167u,43u,
  172u,9u,129u,22u,39u,253u,19u,98u,108u,110u,79u,113u,224u,232u,178u,185u,112u,104u,218u,246u,97u,
  228u,251u,34u,242u,193u,238u,210u,144u,12u,191u,179u,162u,241u,81u,51u,145u,235u,249u,14u,239u,
  107u,49u,192u,214u,31u,181u,199u,106u,157u,184u,84u,204u,176u,115u,121u,50u,45u,127u,4u,150u,254u,
  138u,236u,205u,93u,222u,114u,67u,29u,24u,72u,243u,141u,128u,195u,78u,66u,215u,61u,156u,180u
);

fn fade(t: f32) -> f32 {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

fn grad(hash: u32, x: f32, y: f32) -> f32 {
  let h = hash & 3u;
  let u = select(y, x, h < 2u);
  let v = select(x, y, h < 2u);
  return select(u, -u, (h & 1u) != 0u) + select(2.0 * v, -2.0 * v, (h & 2u) != 0u);
}

fn noise(x: f32, y: f32) -> f32 {
  let X = u32(floor(x)) & 255u;
  let Y = u32(floor(y)) & 255u;
  
  let xf = fract(x);
  let yf = fract(y);
  
  let u = fade(xf);
  let v = fade(yf);
  
  let a = P[X] + Y;
  let b = P[X + 1u] + Y;
  
  let g1 = grad(P[a], xf, yf);
  let g2 = grad(P[b], xf - 1.0, yf);
  let g3 = grad(P[a + 1u], xf, yf - 1.0);
  let g4 = grad(P[b + 1u], xf - 1.0, yf - 1.0);
  
  return mix(
    mix(g1, g2, u),
    mix(g3, g4, u),
    v
  );
}

fn perlin2D(x: f32, y: f32, frequency: f32, octaves: u32, persistence: f32, lacunarity: f32, seed: f32) -> f32 {
  var total = 0.0;
  var amplitude = 1.0;
  var maxValue = 0.0;
  var freq = frequency;
  
  for (var i = 0u; i < octaves; i++) {
    total += noise(x * freq + seed, y * freq + seed) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    freq *= lacunarity;
  }
  
  return total / maxValue;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let x = global_id.x;
  let y = global_id.y;
  
  if (x >= params.resolution || y >= params.resolution) {
    return;
  }
  
  let idx = y * params.resolution + x;
  
  // Base temperature from Perlin noise
  let nx = f32(x) / f32(params.resolution) * params.scale;
  let ny = f32(y) / f32(params.resolution) * params.scale;
  var temperature = perlin2D(nx, ny, params.frequency, params.octaves, params.persistence, params.lacunarity, f32(params.seed));
  
  // Normalize to 0-1
  temperature = (temperature + 1.0) / 2.0;
  
  // Latitude influence (colder toward poles)
  if (params.latitudeInfluence > 0.0) {
    let latitudeFactor = abs(f32(y) / f32(params.resolution) - 0.5) * 2.0;
    temperature -= latitudeFactor * params.latitudeInfluence;
  }
  
  // Elevation influence (higher = colder)
  if (params.elevationInfluence > 0.0) {
    let elevation = heightMap[idx];
    temperature -= elevation * params.elevationInfluence;
  }
  
  // Clamp to 0-1
  output[idx] = clamp(temperature, 0.0, 1.0);
}
