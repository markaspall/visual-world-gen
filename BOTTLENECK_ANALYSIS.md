# Bottleneck Analysis Guide

## 🎯 Primary Metric: **Chunk Request Response Time**

You're absolutely right - **how quickly we respond to a chunk request** is the ultimate benchmark. Everything else is diagnostic to identify WHY we're slow.

---

## 📊 Four Key Bottlenecks

### 1. **🌐 Network Bottleneck**

**What it tracks:**
- Average chunk size (KB)
- Bandwidth (MB/s)
- Total data transferred

**What to look for:**
- ✅ **Good**: 10-30 KB per chunk, 5+ MB/s bandwidth
- ⚠️ **Watch**: 50+ KB per chunk (SVDAG not compressing well)
- 🔴 **Bad**: < 1 MB/s bandwidth (network congestion)

**How to optimize:**
- Improve SVDAG compression
- Enable gzip/brotli compression on HTTP responses
- Use binary formats (already done!)
- CDN for static assets

---

### 2. **💾 Memory Bottleneck**

**What it tracks:**
- Heap usage (MB)
- RSS (Resident Set Size - total memory)
- Memory growth over time

**What to look for:**
- ✅ **Good**: Stable heap < 200 MB, RSS < 500 MB
- ⚠️ **Watch**: Heap growing steadily (memory leak?)
- 🔴 **Bad**: Heap > 1 GB, RSS > 2 GB (will crash!)

**How to optimize:**
- Implement region cache eviction (LRU)
- Clear old chunks from memory
- Profile with `node --inspect`
- Use WeakMap for cached data

---

### 3. **⚙️ CPU Bottleneck**

**What it tracks:**
- CPU time (user + system)
- SVDAG build time
- Voxel generation time

**What to look for:**
- ✅ **Good**: Total time < 10ms per chunk
- ⚠️ **Watch**: SVDAG build > 5ms (consider GPU compression)
- 🔴 **Bad**: Total time > 50ms (will drop frames)

**How to optimize:**
- Move to GPU compute (WebGPU shaders)
- Optimize SVDAG builder algorithm
- Use Worker threads for parallel generation
- Cache region textures in GPU memory

---

### 4. **📈 Response Time (Primary Metric)**

**What it tracks:**
- End-to-end request → response time
- Recent average (last 50 chunks)
- Min/max/avg across all chunks

**Target Performance:**
- ✅ **Excellent**: < 10ms (cached chunk)
- ✅ **Good**: < 50ms (first chunk in region)
- ⚠️ **Acceptable**: < 100ms (with full pipeline)
- 🔴 **Poor**: > 100ms (user will notice lag)

---

## 🔍 How to Use the Dashboard

### Step 1: Identify the Bottleneck

Look at the **Bottleneck Analysis** section:

```
Network:      15.2 KB  |  3.5 MB/s  |  125 MB total
Memory:       180 MB   |  RSS: 420 MB
Response Time: 45ms    |  Primary metric
Throughput:    2.5 chunks/sec
```

### Step 2: Dig into Pipeline Breakdown

Check which stage is slowest:

```
Pipeline Stage Timing:
- Chunk Gen:    3.2ms  ✅ Fast
- SVDAG Build:  42ms   🔴 BOTTLENECK!
- Total:        45.2ms
```

### Step 3: Compare with Baseline

Save a profile, optimize, then compare:

```
Before Optimization:  45ms
After Optimization:   12ms
Improvement:          -33ms (-73%)  ✅
```

---

## 🎯 Optimization Priority

Based on **response time impact**:

### Priority 1: SVDAG Build (CPU)
**Current**: ~40-50ms
**Target**: < 5ms
**Impact**: 🔴 **Critical** - Biggest bottleneck

**Actions:**
- Profile SVDAG builder algorithm
- Move octree building to GPU
- Implement incremental updates
- Use parallel Workers

### Priority 2: Region Caching (Memory + CPU)
**Current**: Regenerating regions repeatedly
**Target**: Cache in GPU memory
**Impact**: 🟡 **High** - Eliminates erosion cost

**Actions:**
- Implement GPU texture cache
- LRU eviction for old regions
- Persist regions to disk

### Priority 3: Network Transfer (Network)
**Current**: 15-30 KB per chunk
**Target**: < 10 KB
**Impact**: 🟢 **Medium** - Not critical yet

**Actions:**
- Improve SVDAG deduplication
- HTTP compression (gzip)
- Delta encoding for updates

### Priority 4: Erosion (GPU)
**Current**: Not implemented yet
**Target**: < 50ms per region
**Impact**: 🟢 **Future** - Only runs once per region

**Actions:**
- Use GPU compute shaders
- Optimize particle count
- Parallel erosion iterations

---

## 📈 Real-World Scenarios

### Scenario 1: Player Flying Fast
```
Problem: Response time spikes to 200ms
Diagnosis: Requesting many chunks simultaneously
Bottleneck: CPU can't keep up with SVDAG builds

Solution:
- Prioritize chunks by distance
- Parallel Workers for generation
- Request throttling (max 5 concurrent)
```

### Scenario 2: Memory Grows Over Time
```
Problem: Heap usage climbs to 1.5 GB after 30 min
Diagnosis: Region cache never evicts
Bottleneck: Memory leak

Solution:
- LRU eviction (keep 20 most recent regions)
- Clear chunk references properly
- Profile with heap snapshots
```

### Scenario 3: First Chunk is Slow
```
Problem: First chunk takes 500ms
Diagnosis: Region generation + erosion
Bottleneck: GPU pipeline not ready

Solution:
- Pre-generate nearby regions
- Show loading indicator
- Stream partial data
- Cache regions to disk
```

---

## 🔧 Monitoring Best Practices

### During Development:
1. **Save baseline** before each optimization
2. **Generate 200+ chunks** for accurate averages
3. **Check all bottleneck metrics** before/after
4. **Profile improvements** in real world (fly fast!)

### In Production:
1. **Alert on response time > 100ms**
2. **Monitor memory growth** (should be stable)
3. **Track bandwidth usage** (for CDN costs)
4. **Log slow requests** for investigation

---

## 🎮 Target Metrics (Full Pipeline)

When everything is implemented:

```
✅ Target Performance:

Response Time:   < 10ms  (cached chunk)
                < 50ms  (new region, first chunk)
                < 15ms  (new chunk in cached region)

Network:        < 15 KB  (avg chunk size)
                > 2 MB/s (bandwidth)

Memory:         < 300 MB (heap)
                < 800 MB (RSS)

CPU:            < 5ms    (SVDAG build)
                < 50ms   (region generation, one-time)

Throughput:     > 10 chunks/sec
```

---

## 🚀 Quick Wins

### Immediate (< 1 hour):
- ✅ Enable HTTP compression (gzip)
- ✅ Implement chunk request throttling
- ✅ Add region cache eviction

### Short-term (< 1 day):
- Move SVDAG build to Worker thread
- Optimize octree builder algorithm
- Cache regions to disk

### Long-term (< 1 week):
- GPU compute shaders for generation
- Full GPU pipeline (LOD 0 → LOD 1)
- Streaming chunk updates

---

## 💡 Remember

**Primary Metric**: Chunk request → response time
**Everything else**: Helps you find WHY it's slow

Use the bottleneck dashboard to:
1. Identify which resource is limiting
2. Profile and optimize that bottleneck
3. Measure impact with saved profiles
4. Repeat until target performance achieved

**Your goal: < 50ms average response time** ⚡
