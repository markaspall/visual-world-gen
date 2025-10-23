# Performance Profile Comparison Guide

Track and compare pipeline performance improvements over time!

## 🎯 What Are Profiles?

A **performance profile** is a snapshot of your pipeline's average performance metrics at a specific point in time. Each profile captures:

- Average timing for each pipeline stage
- Number of samples (chunks processed)
- Cache hit rate
- Min/max values

## 📊 How to Use

### 1. **Collect Performance Data**

Run your pipeline normally:
1. Start server: `npm start`
2. Open world: `http://localhost:3012/world`
3. Fly around to generate chunks (aim for 100+ chunks for good averages)

### 2. **Save a Profile**

When you're happy with the sample size:
1. Click **💾 Save Profile** in the monitor header
2. Enter a descriptive name (e.g., "Before Optimization", "After Erosion Cache")
3. Add optional description (e.g., "Baseline with simple Perlin noise")
4. Click **💾 Save**

Profiles are saved to `storage/profiles/` as JSON files.

### 3. **Set a Baseline**

To compare against a saved profile:
1. Click **📊 Load Baseline**
2. Select a profile from the list
3. Click **📊 Use as Baseline**

### 4. **View Comparison**

The dashboard will now show a **Performance Comparison** section with:
- Current vs baseline timing for each stage
- Green bars = Improvements (faster) ✅
- Red bars = Regressions (slower) ⚠️
- Percentage change for each metric

### 5. **Clear Baseline**

Click the **✕ Clear** button next to the baseline name to stop comparing.

---

## 💡 Use Cases

### Scenario 1: Before/After Optimization

```
1. Generate 200 chunks → Save as "Before Cache Optimization"
2. Implement region caching
3. Reset metrics → Generate 200 chunks → Compare against baseline
4. See: "Region lookup: -45ms (-89%)" 🎉
```

### Scenario 2: Hardware Comparison

```
1. Run on dev machine → Save as "Desktop RTX 3080"
2. Deploy to server → Save as "Server GTX 1660"
3. Load desktop as baseline
4. See performance difference between GPUs
```

### Scenario 3: Pipeline Evolution

```
Save profiles as you add features:
- "v1.0 - Basic Terrain" (baseline)
- "v1.1 - Added Erosion" (+50ms erosion stage)
- "v1.2 - Erosion Optimized" (-30ms erosion!)
- "v2.0 - Full Pipeline" (all features)

Track how complexity and optimization balance out!
```

---

## 📂 Profile Storage

Profiles are stored as JSON files in `storage/profiles/`:

```json
{
  "name": "After Cache Optimization",
  "description": "Implemented region texture cache",
  "timestamp": 1729680000000,
  "samples": 250,
  "timings": {
    "total": { "avg": 12.5, "min": 8.2, "max": 45.3, "samples": 250 },
    "chunkGen": { "avg": 3.2, "min": 2.8, "max": 5.1, "samples": 250 },
    "svdagBuild": { "avg": 2.1, "min": 1.5, "max": 3.2, "samples": 250 }
  },
  "cacheHitRate": 68.4
}
```

You can:
- Back up profiles (copy JSON files)
- Share profiles with team members
- Analyze profiles externally
- Delete old profiles via UI or filesystem

---

## 🎨 Visual Indicators

### In Comparison Grid:

- **Green left border** = Improvement (current is faster)
- **Red left border** = Regression (current is slower)
- **No border** = No significant change

### Percentage Colors:

- **Green with ↓** = `-15% (1.5ms faster)`
- **Red with ↑** = `+12% (2.3ms slower)`

---

## 🔄 Workflow Example

### Day 1: Establish Baseline
```
1. Run world, generate 500 chunks
2. Save as "Baseline - Original Code"
3. Note: 45ms avg total time
```

### Day 2: Optimize Erosion
```
1. Implement erosion shader optimization
2. Reset metrics
3. Generate 500 chunks
4. Load "Baseline - Original Code"
5. See comparison: Erosion -15ms (-30%) ✅
6. Save as "Optimized Erosion v1"
```

### Day 3: Add New Feature
```
1. Implement river generation
2. Reset metrics
3. Generate 500 chunks
4. Load "Optimized Erosion v1"
5. See: Total +8ms (+18%) due to new feature
6. Decide if acceptable or needs optimization
7. Save as "With Rivers v1"
```

---

## ⚡ Tips

### Get Accurate Profiles:
- Generate **100+ chunks** for good averages
- Avoid profiles with < 50 samples (too noisy)
- Let the pipeline stabilize (skip first 20 chunks)

### Meaningful Comparisons:
- Compare similar workloads (same seed, same area)
- Same hardware configuration
- Same chunk generation parameters

### Profile Naming:
Use descriptive names:
- ✅ "After SIMD Optimization - 500 chunks"
- ✅ "Baseline CPU Pipeline"
- ❌ "test1"
- ❌ "new"

### When to Save:
- Before major changes (establish baseline)
- After optimizations (measure impact)
- After adding features (track complexity cost)
- On different hardware (performance comparison)

---

## 🚀 Advanced

### Export Profile Data

Profiles are JSON - you can:
```bash
# Copy profiles to backup
cp storage/profiles/*.json ~/backups/

# Analyze with jq
cat storage/profiles/my_profile.json | jq '.timings.erosion.avg'

# Compare two profiles programmatically
node scripts/compare-profiles.js baseline.json optimized.json
```

### Automated Benchmarking

Create a script to:
1. Start server
2. Generate N chunks
3. Save profile automatically
4. Run after each commit for performance regression testing

---

## 📈 What to Track

### Pipeline Stages (when fully implemented):
- **Base Elevation** - Perlin noise generation
- **Pre-Erosion Moisture** - Moisture map
- **Erosion** - Hydraulic erosion simulation (slowest!)
- **Post-Erosion Moisture** - Current climate
- **Upscale** - 128→512 interpolation
- **Chunk Gen** - 32³ voxel generation
- **SVDAG Build** - Octree compression

### Current (V2 CPU Pipeline):
- **Total** - End-to-end request time
- **Chunk Gen** - Voxel generation
- **SVDAG Build** - Compression time

As the pipeline grows, profiles will capture more stages!

---

## 🎯 Goal

Use profiles to answer:
- "Is my optimization actually faster?"
- "How much overhead did this feature add?"
- "Can we maintain < 10ms average after all features?"
- "Which stage needs optimization most?"

**Track progress. Measure impact. Optimize with confidence!** 📊✨
