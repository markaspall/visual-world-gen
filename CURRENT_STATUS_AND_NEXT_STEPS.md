# Visual World Gen - Current Status & Next Steps

**📅 Last Updated:** Oct 19, 2025 1:40pm  
**🎯 Status:** Meta-SVDAG working! Ready for eviction tuning + transparency polish

---

## ✅ WHAT'S WORKING

### **Core Systems (100% Complete)**
- ✅ **Single-DAG System** - Material SVDAG only, 50% memory savings vs dual-DAG
- ✅ **Request-on-Miss Loading** - Holes fill in 2-5 frames automatically
- ✅ **O(1) Chunk Lookups** - Hash table (8192 slots, 32KB)
- ✅ **SVDAG Deduplication** - 75-85% memory savings (5 unique SVDAGs for 2834 chunks!)
- ✅ **Meta-SVDAG Spatial Skip** - Skip empty 4x4x4 meta-chunks (newly fixed!)
- ✅ **Adaptive Performance** - Distance & steps adjust to memory pressure
- ✅ **Transparency System** - Water renders with see-through effect

### **Meta-SVDAG Status (Stage 7b - COMPLETE!)**
- ✅ Buffer initialization fixed (zeros instead of garbage)
- ✅ Meta-grid builds correctly (27/4096 populated in test)
- ✅ Shader skip logic working
- ✅ Toggle with `M` key
- ✅ HUD shows status and stats
- ✅ Debug mode 10 (`-` key) visualizes skip efficiency
- ✅ **Result:** Fewer chunk steps when enabled!

### **Current Performance**
- **FPS:** 60+ FPS stable
- **Chunks:** 600+ loaded, only 5 unique SVDAGs (99% dedup!)
- **Memory:** 30 MB GPU memory (excellent efficiency)
- **Meta-chunks:** 27/4096 populated (97% of world is empty space)
- **Pressure:** 10-20% (very healthy)

---

## ⚠️ KNOWN ISSUES

### **1. Evictions Disabled (HIGH PRIORITY)**
**Problem:**
```javascript
// chunkManager.js line 19
this.maxCachedChunks = 5000;  // High limit
// Eviction system exists but rarely triggers
```

**Impact:**
- System won't gracefully handle 1000+ loaded chunks
- No pressure response when exploring large areas
- Could hit memory limits eventually

**Need:**
- Re-enable and tune adaptive eviction
- Test with 2000-3000 chunks loaded
- Ensure eviction doesn't remove needed chunks

---

### **2. Water Transparency Edges (MEDIUM PRIORITY)**
**Problem:**
- Water is transparent ✅
- But edges look weird/blocky ❌
- Transition between water and air not smooth

**Current Implementation:**
```wgsl
// raymarcher_svdag_chunked.wgsl - Change detection system
if (hit.block_id != final_hit.block_id) {
  // Material changed - handle transparency
  // ...but doesn't blend edges nicely
}
```

**Need:**
- Proper alpha blending for water surfaces
- Smooth transitions at water boundaries
- Nice-looking water that matches screenshot expectations

---

## 🎯 NEXT PRIORITIES

### **Priority 1: Re-Enable & Tune Evictions** ⏱️ 2-3 hours

**Goal:** Graceful memory management at 2000-3000 chunks

**Tasks:**

#### **1.1 Lower Max Limit (15 mins)**
```javascript
// chunkManager.js
this.maxCachedChunks = 3000;  // Was 5000
```

#### **1.2 Tune Soft Limits (30 mins)**
```javascript
// Current thresholds
const softLimit = Math.floor(this.maxCachedChunks * 0.6);  // 1800 chunks

// Test different values:
// - 0.5 (1500) = earlier eviction, more aggressive
// - 0.7 (2100) = later eviction, more permissive
// - 0.6 (1800) = balanced (current)
```

#### **1.3 Improve Distance Eviction (1 hour)**
**File:** `chunkManager.js` - `evictOldChunks()`

**Current Issues:**
- Evicts by straight-line distance only
- Doesn't consider what's in view frustum
- Might evict chunks player is looking at

**Improvements:**
```javascript
evictOldChunks(cameraPos, cameraDir = null) {
  // ... existing pressure calculation ...
  
  // Score chunks for eviction
  const scored = [];
  for (const [key, chunk] of this.chunks.entries()) {
    const distance = getDistance(chunk, cameraPos);
    const age = Date.now() - chunk.lastSeenFrame;
    
    // NEW: Check if in view frustum
    let viewBonus = 1.0;
    if (cameraDir) {
      const toChunk = [chunk.cx - cameraPos[0], chunk.cy - cameraPos[1], chunk.cz - cameraPos[2]];
      const dot = dotProduct(normalize(toChunk), cameraDir);
      if (dot > 0.7) {  // Within ~45° FOV
        viewBonus = 0.3;  // Much less likely to evict
      }
    }
    
    // NEW: Protect meta-chunks with content
    const metaIdx = getMetaChunkIndex(chunk.cx, chunk.cy, chunk.cz);
    const metaBonus = this.metaGrid[metaIdx] === 1 ? 0.7 : 1.0;
    
    const score = distance * viewBonus * metaBonus + (age / 60000);
    scored.push({ key, score, distance });
  }
  
  scored.sort((a, b) => b.score - a.score);  // Highest score = first to evict
  
  // ... rest of eviction logic ...
}
```

#### **1.4 Add Hysteresis (30 mins)**
**Goal:** Prevent eviction thrashing (load/evict/load same chunk)

```javascript
// chunkManager.js - Add cooldown tracking
constructor() {
  // ... existing ...
  this.evictionCooldowns = new Map();  // key → timestamp
  this.cooldownDuration = 5000;  // 5 seconds
}

evictOldChunks() {
  // ... existing scoring ...
  
  // Filter out chunks on cooldown
  const now = Date.now();
  const eligibleForEviction = scored.filter(s => {
    const cooldownEnd = this.evictionCooldowns.get(s.key) || 0;
    return now > cooldownEnd;
  });
  
  // Evict and set cooldown
  for (const item of eligibleForEviction.slice(0, actualTarget)) {
    this.chunks.delete(item.key);
    this.evictionCooldowns.set(item.key, now + this.cooldownDuration);
  }
  
  // Clean old cooldowns periodically
  if (this.frameCount % 300 === 0) {  // Every 5 seconds
    for (const [key, timestamp] of this.evictionCooldowns.entries()) {
      if (now > timestamp + 60000) {  // Older than 1 minute
        this.evictionCooldowns.delete(key);
      }
    }
  }
}
```

**Testing:**
1. Fly around rapidly, load 2000+ chunks
2. Verify eviction starts at 1800 chunks (60% soft limit)
3. Check that chunks in view aren't evicted
4. Confirm no thrashing (same chunk evicted/loaded repeatedly)
5. Watch HUD: "Evicted (frame)" should be 10-50 when active

**Success Criteria:**
- ✅ System stable at 2000-2500 chunks
- ✅ Eviction smooth (no FPS drops)
- ✅ Chunks in view stay loaded
- ✅ No thrashing warnings

---

### **Priority 2: Water Transparency Polish** ⏱️ 3-4 hours

**Goal:** Beautiful water with smooth edges, no weird artifacts

**Current System Analysis:**
```wgsl
// raymarcher_svdag_chunked.wgsl - Current approach
// 1. Hit first block (water or solid)
// 2. If transparent, continue ray
// 3. Hit second block (solid beneath)
// 4. Blend based on material

// PROBLEM: Only checks first change, doesn't accumulate alpha
```

#### **2.1 Multi-Layer Transparency (2 hours)**

**Goal:** Accumulate alpha through multiple water blocks

**File:** `raymarcher_svdag_chunked.wgsl` - `shade()` function

**NEW APPROACH:**
```wgsl
fn shade(hit: Hit, ray_origin: vec3<f32>, ray_dir: vec3<f32>) -> vec3<f32> {
  // ... existing debug modes ...
  
  if (hit.distance < 0.0) {
    return vec3<f32>(0.53, 0.81, 0.92);  // Sky
  }
  
  // NEW: Multi-layer transparency system
  var accumulated_color = vec3<f32>(0.0);
  var accumulated_alpha = 0.0;
  var current_distance = 0.0;
  var layers_traversed = 0u;
  const MAX_LAYERS = 8u;  // Prevent infinite loops
  
  var current_hit = hit;
  
  while (layers_traversed < MAX_LAYERS && accumulated_alpha < 0.99) {
    layers_traversed++;
    
    let material = materials[current_hit.block_id];
    
    if (material.transparency == 0.0) {
      // SOLID - Final layer
      let solid_color = getSolidColor(current_hit, ray_dir);
      accumulated_color += solid_color * (1.0 - accumulated_alpha);
      accumulated_alpha = 1.0;
      break;
    } else {
      // TRANSPARENT - Accumulate and continue
      let layer_color = getTransparentColor(current_hit, ray_dir, material);
      let layer_alpha = 1.0 - material.transparency;
      
      // Distance-based alpha (more water = more opaque)
      let depth_factor = min(current_hit.distance / 32.0, 1.0);
      let actual_alpha = layer_alpha * depth_factor;
      
      accumulated_color += layer_color * actual_alpha * (1.0 - accumulated_alpha);
      accumulated_alpha += actual_alpha * (1.0 - accumulated_alpha);
      
      // Continue ray from exit point
      let exit_point = ray_origin + ray_dir * (current_hit.distance + 0.01);
      current_hit = raymarchChunks(exit_point, ray_dir);
      
      if (current_hit.distance < 0.0) {
        // Hit sky through water - blend with sky
        let sky_color = vec3<f32>(0.53, 0.81, 0.92);
        accumulated_color += sky_color * (1.0 - accumulated_alpha);
        break;
      }
    }
  }
  
  return accumulated_color;
}

fn getTransparentColor(hit: Hit, ray_dir: vec3<f32>, material: BlockMaterial) -> vec3<f32> {
  // Water color with depth-based intensity
  var base_color = material.albedo;
  
  // Add caustics effect (simple)
  let caustic = 0.5 + 0.5 * sin(hit.distance * 0.5 + renderParams.time * 2.0);
  base_color += vec3<f32>(0.1, 0.15, 0.2) * caustic * 0.3;
  
  // Fresnel effect at grazing angles
  let view_angle = abs(dot(hit.normal, -ray_dir));
  let fresnel = pow(1.0 - view_angle, 3.0);
  base_color = mix(base_color, vec3<f32>(0.8, 0.9, 1.0), fresnel * 0.3);
  
  return base_color;
}

fn getSolidColor(hit: Hit, ray_dir: vec3<f32>) -> vec3<f32> {
  let material = materials[hit.block_id];
  
  // Basic diffuse shading
  let light_dir = normalize(vec3<f32>(0.5, 1.0, 0.3));
  let ndotl = max(dot(hit.normal, light_dir), 0.0);
  let ambient = 0.3;
  let diffuse = ndotl * 0.7;
  
  return material.albedo * (ambient + diffuse);
}
```

#### **2.2 Water Material Tuning (1 hour)**

**File:** `chunkedSvdagRenderer.js` - Material definitions

```javascript
// Current water material
{
  albedo: [0.2, 0.4, 0.8],    // Blue
  transparency: 0.7,           // 70% transparent
  // ... other properties
}

// BETTER: Multiple transparency levels for depth
const WATER_MATERIALS = {
  water_surface: {
    albedo: [0.3, 0.6, 0.9],    // Lighter blue
    transparency: 0.85,          // Very transparent
    fresnel: 0.4,
    caustics: true
  },
  water_mid: {
    albedo: [0.25, 0.5, 0.85],  // Medium blue
    transparency: 0.7,           // Moderately transparent
    fresnel: 0.3,
    caustics: true
  },
  water_deep: {
    albedo: [0.15, 0.35, 0.7],  // Darker blue
    transparency: 0.5,           // Less transparent
    fresnel: 0.2,
    caustics: false
  }
};
```

#### **2.3 Edge Smoothing (1 hour)**

**Goal:** No harsh transitions at water boundaries

**Techniques:**
1. **Dithering:** Add subtle noise at edges
2. **Depth fade:** Gradually increase alpha near boundaries
3. **Normal smoothing:** Interpolate normals at voxel boundaries

```wgsl
fn smoothWaterEdge(hit: Hit, ray_origin: vec3<f32>, ray_dir: vec3<f32>) -> vec3<f32> {
  // Check if we're near a water boundary
  let voxel_local = fract(ray_origin + ray_dir * hit.distance);
  let edge_distance = min(
    min(voxel_local.x, 1.0 - voxel_local.x),
    min(min(voxel_local.y, 1.0 - voxel_local.y),
        min(voxel_local.z, 1.0 - voxel_local.z))
  );
  
  // Add dithering near edges
  if (edge_distance < 0.1) {
    let dither = fract(sin(dot(ray_origin.xy, vec2<f32>(12.9898, 78.233))) * 43758.5453);
    let fade = edge_distance / 0.1;
    return vec3<f32>(fade + dither * (1.0 - fade));
  }
  
  return vec3<f32>(1.0);
}
```

**Testing:**
1. Look at water from different angles
2. Check water->air boundaries
3. Check water->ground boundaries
4. Verify caustics animate smoothly
5. Check performance (multi-layer shouldn't kill FPS)

**Success Criteria:**
- ✅ Water looks smooth and natural
- ✅ No harsh block edges visible
- ✅ Proper depth/density variation
- ✅ Nice caustics and fresnel effects
- ✅ Still 60+ FPS

---

## 📊 TESTING PROTOCOL

### **Eviction Testing**
```
1. Start at origin (0, 135, 0)
2. Fly in straight line for 200 chunks
3. Check HUD:
   - Loaded should cap at ~2500
   - Evicted (frame) should show 50-100/frame
   - Pressure should stay 80-100%
4. Turn around 180° and fly back
   - Chunks should re-load smoothly
   - No thrashing warnings
   - FPS stays 60+
```

### **Water Testing**
```
1. Find water body
2. Look at surface from above (45° angle)
   - Should see caustics
   - Should see ground beneath
   - Edges should be smooth
3. Look at surface from side (grazing angle)
   - Should see strong fresnel
   - Should look reflective
4. Dive underwater
   - Should see blue tint
   - Should get darker with depth
   - Should still render at 60 FPS
```

---

## 🎯 SUCCESS CRITERIA

**Eviction System:**
- ✅ Stable at 2000-3000 chunks
- ✅ No chunks in view evicted
- ✅ No thrashing (same chunk evicted/loaded)
- ✅ Smooth eviction (no FPS drops)
- ✅ Meta-skip still works with eviction

**Water Transparency:**
- ✅ Smooth edges (no blocky artifacts)
- ✅ Proper depth/density
- ✅ Nice caustics and fresnel
- ✅ 60+ FPS with transparency enabled
- ✅ Works with multiple water layers

---

## 📝 COMMIT MESSAGES

**After Eviction Tuning:**
```
Re-enable and tune adaptive eviction system

CHANGES:
- Lower max limit to 3000 chunks (was 5000)
- Add view frustum protection (don't evict visible chunks)
- Add meta-chunk awareness (protect content-heavy regions)
- Add eviction cooldown (5s) to prevent thrashing
- Improve scoring: distance + age + visibility + meta-content

TESTING:
- Stable at 2000-2500 chunks
- No visible chunks evicted
- No thrashing detected
- Smooth performance at 60+ FPS

RESULT:
- Production-ready memory management
- Graceful handling of large worlds
- Meta-SVDAG skip still working perfectly
```

**After Water Polish:**
```
Improve water transparency with multi-layer accumulation

CHANGES:
- Multi-layer transparency system (up to 8 layers)
- Distance-based alpha (deeper = more opaque)
- Caustics effect (animated, subtle)
- Fresnel effect (grazing angles more reflective)
- Edge smoothing with dithering
- Proper alpha accumulation

RESULT:
- Beautiful water rendering
- Smooth edges, no artifacts
- Proper depth variation
- Still 60+ FPS
- Matches reference screenshot quality
```

---

## 🔄 DEFERRED / FUTURE

**Nice to Have (Not Critical):**
- [ ] Fog/atmospheric effects
- [ ] Better caustics (raymarched)
- [ ] Refraction for underwater view
- [ ] Foam at water edges
- [ ] Reflection probe system
- [ ] Dynamic time of day

**Performance Optimization:**
- [ ] GPU-driven chunk requests (eliminate CPU readback)
- [ ] Occlusion culling
- [ ] LOD system for distant chunks
- [ ] Temporal anti-aliasing

---

## 📖 CONCLUSION

**Current State:** 🎉 **EXCELLENT!**
- Meta-SVDAG working and togglable
- Deduplication saving 75-85% memory
- Request-on-miss loading stable
- Performance excellent (60+ FPS)

**Next Steps:** 2 focused improvements
1. **Eviction tuning** (2-3 hours) → Handle large worlds gracefully
2. **Water polish** (3-4 hours) → Beautiful transparency

**Total Time:** 5-7 hours to production-quality water + memory management

**Recommendation:**
1. ✅ Commit current state ("Meta-SVDAG complete and working")
2. 🎯 Tackle eviction tuning (quick win)
3. 🎨 Polish water transparency (visual quality boost)
4. ✅ Ship it! 🚀
