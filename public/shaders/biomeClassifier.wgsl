struct Params {
  resolution: u32,
  numBiomes: u32,
  padding: u32,
  padding2: u32,
}

struct BiomeRule {
  heightMin: f32,
  heightMax: f32,
  moistureMin: f32,
  moistureMax: f32,
  tempMin: f32,
  tempMax: f32,
  waterMin: f32,
  waterMax: f32,
  colorR: f32,
  colorG: f32,
  colorB: f32,
  padding: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> biomes: array<BiomeRule>;
@group(0) @binding(2) var<storage, read> heightMap: array<f32>;
@group(0) @binding(3) var<storage, read> moistureMap: array<f32>;
@group(0) @binding(4) var<storage, read> temperatureMap: array<f32>;
@group(0) @binding(5) var<storage, read> waterMap: array<f32>;
@group(0) @binding(6) var<storage, read_write> colorOutput: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read_write> biomeOutput: array<u32>;

fn matchesBiome(height: f32, moisture: f32, temp: f32, water: f32, biome: BiomeRule) -> i32 {
  var specificity = 0;
  
  // Check height
  if (biome.heightMin >= 0.0) {
    if (height < biome.heightMin || height > biome.heightMax) {
      return -1;
    }
    specificity++;
  }
  
  // Check moisture
  if (biome.moistureMin >= 0.0) {
    if (moisture < biome.moistureMin || moisture > biome.moistureMax) {
      return -1;
    }
    specificity++;
  }
  
  // Check temperature
  if (biome.tempMin >= 0.0) {
    if (temp < biome.tempMin || temp > biome.tempMax) {
      return -1;
    }
    specificity++;
  }
  
  // Check water
  if (biome.waterMin >= 0.0) {
    if (water < biome.waterMin || water > biome.waterMax) {
      return -1;
    }
    specificity++;
  }
  
  return specificity;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let x = global_id.x;
  let y = global_id.y;
  
  if (x >= params.resolution || y >= params.resolution) {
    return;
  }
  
  let idx = y * params.resolution + x;
  
  let height = heightMap[idx];
  let moisture = moistureMap[idx];
  let temp = temperatureMap[idx];
  let water = waterMap[idx];
  
  // Find best matching biome (most specific)
  var bestBiome = 0u;
  var bestSpecificity = -1;
  
  for (var i = 0u; i < params.numBiomes; i++) {
    let spec = matchesBiome(height, moisture, temp, water, biomes[i]);
    if (spec > bestSpecificity) {
      bestBiome = i;
      bestSpecificity = spec;
    }
  }
  
  // Output color and biome ID
  let biome = biomes[bestBiome];
  colorOutput[idx] = vec4<f32>(biome.colorR, biome.colorG, biome.colorB, 1.0);
  biomeOutput[idx] = bestBiome;
}
