# Dual Eviction System

## Overview
Hybrid proactive + reactive eviction system for chunk cache management.

## Cache Limits
```javascript
Soft Limit: 20,000 chunks (~2.5MB)
Hard Limit: 25,000 chunks (~3.1MB)
```

## Eviction Strategy

### 1. Proactive Trim (Gentle)
**Runs:** Every 5 seconds  
**Triggers:** When cache > soft limit  
**Target:** 90% of soft limit (18,000 chunks)  
**Cooldown:** 3 seconds between trims  

**Purpose:** Prevent cache from growing unbounded during exploration

### 2. Emergency Evict (Aggressive)
**Runs:** Immediately when cache > hard limit  
**Target:** 80% of soft limit (16,000 chunks)  
**No cooldown** - emergency mode

**Purpose:** Hard safety net to prevent memory overflow

## Priority Scoring
Chunks are scored for eviction (higher = evict first):

```
score = 0.6 * time_factor + 0.3 * distance_factor + 0.1 * content_factor

where:
  time_factor    = (now - lastSeenFrame) / MAX_AGE (5 minutes)
  distance_factor = distance_from_camera / MAX_DISTANCE (20 chunks)
  content_factor = 1.0 - chunk_density (currently unused)
```

**Weights:**
- **60%** - Temporal (how long since last seen)
- **30%** - Spatial (how far from camera)
- **10%** - Content (how empty the chunk is)

## Protection Rules

**Never evict:**
1. Chunks < 2 seconds old
2. Chunks within 3 chunk radius of camera
3. Chunks currently in view frustum (via lastSeenFrame)

## HUD Display

**Chunk Cache Section:**
- Loaded count with soft/hard limits
- Soft fill % (orange at 80%, red at 100%)
- Hard fill % (orange at 80%, red at 95%)

**Eviction Section:**
- Current strategy (proactive/emergency/none)
- Evictions this frame (orange if > 0)
- Proactive eviction count
- Emergency eviction count (red if > 0)
- Total evictions

## Benefits

✅ **Prevents runaway growth** - regular 5s trimming  
✅ **Smooth performance** - small frequent evictions vs large rare ones  
✅ **Safety net** - hard limit protection  
✅ **No thrashing** - 3s cooldown prevents rapid evict/reload cycles  
✅ **Exploration-friendly** - high limits (20K+) allow free movement  
✅ **Transparent** - HUD shows exactly what's happening

## Configuration

Located in `chunkManager.js` constructor:

```javascript
this.hardCacheLimit = 25000;         // Emergency eviction threshold
this.softCacheLimit = 20000;         // Proactive trim threshold
this.evictionCooldown = 3000;        // 3s between evictions
this.trimInterval = 5000;            // Check every 5s
this.trimTargetRatio = 0.9;          // Trim to 90% of soft limit
this.emergencyTargetRatio = 0.8;     // Emergency: 80% of soft limit
this.maxEvictionsPerFrame = 100;     // Rate limit
this.minChunkAgeMs = 2000;           // Don't evict if < 2s old
this.cameraProtectionRadius = 3;     // Protect chunks near camera
```

## Usage

The system runs automatically in the render loop:

```javascript
// Proactive trim (every 5s if over soft limit)
const proactiveEvicted = this.chunkManager.proactiveTrim(cameraPos);

// Emergency eviction (if over hard limit)
if (chunks.size > hardLimit) {
  const emergencyEvicted = this.chunkManager.emergencyEvict(cameraPos);
}
```

## Monitoring

Watch the HUD for:
- **Soft fill** climbing toward 100% → proactive trim will kick in
- **Emergency evictions** → increase cache limits or reduce view distance
- **High proactive count** → normal, shows system is working
- **"none" strategy** → under soft limit, no eviction needed
