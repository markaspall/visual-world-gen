struct Params {
  resolution: u32,
  numBlocks: u32,
  numBiomeRules: u32,
  useNoise1: u32,
  noise1Influence: f32,
  waterBlockId: u32,
  padding1: u32,
  padding2: u32,
}

struct Block {
  id: u32,
  color: vec4<f32>, // RGBA
  properties: vec4<f32>, // transparent, emissive, reflective, refractive
}

struct BiomeRule {
  biomeId: u32,
  numTerrainBlocks: u32,
  terrainStartIdx: u32,
  numWaterBlocks: u32,
  waterStartIdx: u32,
  padding1: u32,
  padding2: u32,
  padding3: u32,
}

struct BlockWeight {
  blockId: u32,
  weight: f32,
  padding1: u32,
  padding2: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> blocks: array<Block>;
@group(0) @binding(2) var<storage, read> biomeRules: array<BiomeRule>;
@group(0) @binding(3) var<storage, read> blockWeights: array<BlockWeight>;
@group(0) @binding(4) var<storage, read> biomeMap: array<u32>;
@group(0) @binding(5) var<storage, read> waterMap: array<f32>;
@group(0) @binding(6) var<storage, read> heightMap: array<f32>;
@group(0) @binding(7) var<storage, read> noise1Map: array<f32>;
@group(0) @binding(8) var<storage, read_write> blockData: array<vec2<u32>>; // [terrain, water] interleaved

// Select terrain block based on weights and noise
fn selectTerrainBlock(ruleIdx: u32, noise: f32) -> u32 {
  let rule = biomeRules[ruleIdx];
  let startIdx = rule.terrainStartIdx;
  let numBlocks = rule.numTerrainBlocks;
  
  if (numBlocks == 0u) {
    return 0u;
  }
  
  // Calculate total weight
  var totalWeight = 0.0;
  for (var i = 0u; i < numBlocks; i = i + 1u) {
    totalWeight += blockWeights[startIdx + i].weight;
  }
  
  // Use noise as random selector (0-1)
  let selector = noise * totalWeight;
  
  // Find which block this selector lands on
  var accumulated = 0.0;
  for (var i = 0u; i < numBlocks; i = i + 1u) {
    accumulated += blockWeights[startIdx + i].weight;
    if (selector <= accumulated) {
      return blockWeights[startIdx + i].blockId;
    }
  }
  
  // Fallback to first block
  return blockWeights[startIdx].blockId;
}

// Select water block based on weights and noise
fn selectWaterBlock(ruleIdx: u32, noise: f32) -> u32 {
  let rule = biomeRules[ruleIdx];
  let startIdx = rule.waterStartIdx;
  let numBlocks = rule.numWaterBlocks;
  
  if (numBlocks == 0u) {
    return 0u; // No water block defined
  }
  
  // Calculate total weight
  var totalWeight = 0.0;
  for (var i = 0u; i < numBlocks; i = i + 1u) {
    totalWeight += blockWeights[startIdx + i].weight;
  }
  
  // Use noise as random selector (0-1)
  let selector = noise * totalWeight;
  
  // Find which block this selector lands on
  var accumulated = 0.0;
  for (var i = 0u; i < numBlocks; i = i + 1u) {
    accumulated += blockWeights[startIdx + i].weight;
    if (selector <= accumulated) {
      return blockWeights[startIdx + i].blockId;
    }
  }
  
  // Fallback to first block
  return blockWeights[startIdx].blockId;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let x = global_id.x;
  let y = global_id.y;
  let resolution = params.resolution;
  
  if (x >= resolution || y >= resolution) {
    return;
  }
  
  let idx = y * resolution + x;
  let biomeId = biomeMap[idx];
  let waterDepth = waterMap[idx];
  let height = heightMap[idx];
  let noise = noise1Map[idx];
  
  // Find biome rule
  var ruleIdx = 0u;
  var found = false;
  for (var i = 0u; i < params.numBiomeRules; i = i + 1u) {
    if (biomeRules[i].biomeId == biomeId) {
      ruleIdx = i;
      found = true;
      break;
    }
  }
  
  // Select terrain block (always use rule even if not found, for debugging)
  var terrainBlockId = 0u;
  if (found && biomeRules[ruleIdx].numTerrainBlocks > 0u) {
    terrainBlockId = selectTerrainBlock(ruleIdx, noise);
  } else if (params.numBiomeRules > 0u) {
    // Fallback to first rule if biome not found
    terrainBlockId = selectTerrainBlock(0u, noise);
  }
  
  // Select water block if water present (biome-specific)
  var waterBlockId = 0u;
  if (waterDepth > 0.01) {
    if (found && biomeRules[ruleIdx].numWaterBlocks > 0u) {
      // Use biome-specific water blocks
      waterBlockId = selectWaterBlock(ruleIdx, noise);
    } else if (params.numBiomeRules > 0u) {
      // Fallback to first rule's water
      waterBlockId = selectWaterBlock(0u, noise);
    } else {
      // Last resort: default water block
      waterBlockId = params.waterBlockId;
    }
  }
  
  // Write interleaved data: [terrain, water]
  blockData[idx] = vec2<u32>(terrainBlockId, waterBlockId);
}
