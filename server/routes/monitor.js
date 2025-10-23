import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROFILES_DIR = path.join(__dirname, '../../storage/profiles');

const router = express.Router();

// Ensure profiles directory exists
try {
  await fs.mkdir(PROFILES_DIR, { recursive: true });
} catch (err) {
  console.error('Failed to create profiles directory:', err);
}

// In-memory metrics storage (replace with DB for production)
class MetricsCollector {
  constructor() {
    this.reset();
    this.baselineProfile = null; // For comparison
  }

  reset() {
    this.requests = [];
    this.chunkStats = {
      total: 0,
      cached: 0, // Full chunk cache (future)
      regionCached: 0, // Region texture cached (CPU Perlin)
      fullGeneration: 0 // New region generation
    };
    this.timings = {
      total: [],
      baseElevation: [],
      preErosionMoisture: [],
      erosion: [],
      postErosionMoisture: [],
      upscale: [],
      chunkGen: [],
      svdagBuild: []
    };
    this.regions = new Map(); // regionKey -> { firstChunk, chunksGenerated }
    
    // Bottleneck tracking
    this.bottlenecks = {
      network: {
        totalBytes: 0,
        chunkSizes: [],
        bandwidth: [] // bytes per second samples
      },
      memory: {
        samples: []
      },
      cpu: {
        samples: []
      }
    };
    
    this.startTime = Date.now();
  }

  recordRequest(data) {
    const now = Date.now();
    
    // Record request
    this.requests.push({
      timestamp: now,
      chunkCoords: `${data.cx},${data.cy},${data.cz}`,
      cached: data.cached,
      totalTime: data.totalTime,
      stages: data.stages || {},
      chunkSize: data.chunkSize || 0
    });

    // Keep last 1000 requests
    if (this.requests.length > 1000) {
      this.requests.shift();
    }

    // Update chunk stats
    this.chunkStats.total++;
    if (data.cached) {
      this.chunkStats.cached++;
    } else if (data.regionCached) {
      this.chunkStats.regionCached++;
    } else {
      this.chunkStats.fullGeneration++;
    }
    
    // Track network bottleneck
    if (data.chunkSize) {
      this.bottlenecks.network.totalBytes += data.chunkSize;
      this.bottlenecks.network.chunkSizes.push(data.chunkSize);
      
      // Calculate bandwidth (bytes per second)
      if (data.totalTime > 0) {
        const bytesPerSecond = (data.chunkSize / data.totalTime) * 1000;
        this.bottlenecks.network.bandwidth.push(bytesPerSecond);
      }
      
      // Keep last 500 samples
      if (this.bottlenecks.network.chunkSizes.length > 500) {
        this.bottlenecks.network.chunkSizes = this.bottlenecks.network.chunkSizes.slice(-500);
      }
      if (this.bottlenecks.network.bandwidth.length > 500) {
        this.bottlenecks.network.bandwidth = this.bottlenecks.network.bandwidth.slice(-500);
      }
    }

    // Record timings
    this.timings.total.push(data.totalTime);
    if (data.stages) {
      for (const [stage, time] of Object.entries(data.stages)) {
        if (this.timings[stage]) {
          this.timings[stage].push(time);
        }
      }
    }

    // Keep last 500 timing samples
    for (const key of Object.keys(this.timings)) {
      if (this.timings[key].length > 500) {
        this.timings[key] = this.timings[key].slice(-500);
      }
    }

    // Track region generation
    if (data.regionKey && !data.cached) {
      if (!this.regions.has(data.regionKey)) {
        this.regions.set(data.regionKey, {
          firstChunkTime: data.totalTime,
          chunksGenerated: 1
        });
      } else {
        this.regions.get(data.regionKey).chunksGenerated++;
      }
    }
  }

  // Sample current resource usage
  sampleResources() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    this.bottlenecks.memory.samples.push({
      timestamp: Date.now(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss
    });
    
    this.bottlenecks.cpu.samples.push({
      timestamp: Date.now(),
      user: cpuUsage.user,
      system: cpuUsage.system
    });
    
    // Keep last 300 samples (5 minutes at 1 sample/sec)
    if (this.bottlenecks.memory.samples.length > 300) {
      this.bottlenecks.memory.samples = this.bottlenecks.memory.samples.slice(-300);
    }
    if (this.bottlenecks.cpu.samples.length > 300) {
      this.bottlenecks.cpu.samples = this.bottlenecks.cpu.samples.slice(-300);
    }
  }

  getStats() {
    const now = Date.now();
    const uptimeMs = now - this.startTime;

    // Calculate averages
    const avg = (arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const recent = (arr, n = 50) => arr.slice(-n);

    // Timing stats
    const timingStats = {};
    for (const [key, values] of Object.entries(this.timings)) {
      if (values.length > 0) {
        timingStats[key] = {
          avg: avg(values),
          recent: avg(recent(values)),
          min: Math.min(...values),
          max: Math.max(...values),
          count: values.length
        };
      }
    }

    // Request rate (chunks per second)
    const recentRequests = this.requests.filter(r => r.timestamp > now - 60000); // Last minute
    const requestRate = recentRequests.length / 60;

    // Cache hit rate
    const cacheHitRate = this.chunkStats.total > 0 
      ? (this.chunkStats.cached / this.chunkStats.total) * 100 
      : 0;
    
    // Sample current resources
    this.sampleResources();
    
    // Bottleneck analysis
    const bottlenecks = {
      network: {
        totalBytes: this.bottlenecks.network.totalBytes,
        avgChunkSize: avg(this.bottlenecks.network.chunkSizes),
        avgBandwidth: avg(this.bottlenecks.network.bandwidth),
        totalMB: (this.bottlenecks.network.totalBytes / 1024 / 1024).toFixed(2)
      },
      memory: {
        current: this.bottlenecks.memory.samples.length > 0 
          ? this.bottlenecks.memory.samples[this.bottlenecks.memory.samples.length - 1]
          : null,
        avgHeapUsed: avg(this.bottlenecks.memory.samples.map(s => s.heapUsed))
      },
      cpu: {
        samples: this.bottlenecks.cpu.samples.length
      }
    };

    return {
      uptime: {
        ms: uptimeMs,
        formatted: this.formatUptime(uptimeMs)
      },
      chunks: {
        ...this.chunkStats,
        cacheHitRate: cacheHitRate.toFixed(1),
        requestRate: requestRate.toFixed(2)
      },
      timings: timingStats,
      regions: {
        total: this.regions.size,
        list: Array.from(this.regions.entries()).map(([key, data]) => ({
          key,
          ...data
        }))
      },
      bottlenecks,
      recentRequests: this.requests.slice(-20).reverse()
    };
  }

  getTimeSeriesData(minutes = 5) {
    const now = Date.now();
    const cutoff = now - (minutes * 60 * 1000);
    const recentRequests = this.requests.filter(r => r.timestamp > cutoff);

    // Group by time buckets (10 second intervals)
    const bucketSize = 10000;
    const buckets = new Map();

    for (const req of recentRequests) {
      const bucket = Math.floor(req.timestamp / bucketSize) * bucketSize;
      if (!buckets.has(bucket)) {
        buckets.set(bucket, {
          timestamp: bucket,
          count: 0,
          cached: 0,
          regionCached: 0,
          fullGen: 0,
          avgTime: []
        });
      }
      const b = buckets.get(bucket);
      b.count++;
      if (req.cached) {
        b.cached++;
      } else if (req.regionCached) {
        b.regionCached++;
      } else {
        b.fullGen++;
      }
      b.avgTime.push(req.totalTime);
    }

    // Convert to sorted array and calculate averages
    const series = Array.from(buckets.values())
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(b => ({
        timestamp: b.timestamp,
        count: b.count,
        cached: b.cached,
        regionCached: b.regionCached,
        fullGen: b.fullGen,
        avgTime: b.avgTime.length > 0 
          ? b.avgTime.reduce((a, c) => a + c, 0) / b.avgTime.length 
          : 0
      }));

    return series;
  }

  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  // Create a profile from current averages
  createProfile(name, description = '') {
    const avg = (arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const profile = {
      name,
      description,
      timestamp: Date.now(),
      samples: this.chunkStats.total,
      timings: {}
    };

    // Capture average timings for each stage
    for (const [key, values] of Object.entries(this.timings)) {
      if (values.length > 0) {
        profile.timings[key] = {
          avg: avg(values),
          min: Math.min(...values),
          max: Math.max(...values),
          samples: values.length
        };
      }
    }

    // Add aggregate stats
    profile.cacheHitRate = this.chunkStats.total > 0 
      ? (this.chunkStats.cached / this.chunkStats.total) * 100 
      : 0;

    return profile;
  }

  // Set baseline for comparison
  setBaseline(profile) {
    this.baselineProfile = profile;
  }

  // Get comparison with baseline
  getComparison() {
    if (!this.baselineProfile) return null;

    const current = this.createProfile('Current', 'Live metrics');
    const baseline = this.baselineProfile;
    const comparison = {
      baseline: baseline.name,
      improvements: {},
      regressions: {}
    };

    // Compare each timing stage
    for (const stage of Object.keys(current.timings)) {
      if (baseline.timings[stage]) {
        const currentAvg = current.timings[stage].avg;
        const baselineAvg = baseline.timings[stage].avg;
        const diff = currentAvg - baselineAvg;
        const percentChange = ((diff / baselineAvg) * 100).toFixed(1);

        comparison[stage] = {
          current: currentAvg,
          baseline: baselineAvg,
          diff,
          percentChange: parseFloat(percentChange),
          improved: diff < 0
        };

        if (diff < 0) {
          comparison.improvements[stage] = Math.abs(diff);
        } else if (diff > 0) {
          comparison.regressions[stage] = diff;
        }
      }
    }

    return comparison;
  }
}

const metrics = new MetricsCollector();

// Export metrics collector so chunksv2 can use it
export { metrics };

// Dashboard view
router.get('/', (req, res) => {
  res.render('monitor', { 
    title: 'V2 Pipeline Monitor'
  });
});

// API: Get current stats
router.get('/api/stats', (req, res) => {
  res.json(metrics.getStats());
});

// API: Get time series data
router.get('/api/timeseries', (req, res) => {
  const minutes = parseInt(req.query.minutes) || 5;
  res.json(metrics.getTimeSeriesData(minutes));
});

// API: Reset metrics
router.post('/api/reset', (req, res) => {
  metrics.reset();
  res.json({ success: true, message: 'Metrics reset' });
});

// API: Save current profile
router.post('/api/profiles/save', async (req, res) => {
  try {
    const { name, description } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Profile name is required' });
    }

    // Create profile from current metrics
    const profile = metrics.createProfile(name, description || '');
    
    // Save to file
    const filename = `${Date.now()}_${name.replace(/[^a-z0-9]/gi, '_')}.json`;
    const filepath = path.join(PROFILES_DIR, filename);
    await fs.writeFile(filepath, JSON.stringify(profile, null, 2));

    res.json({ success: true, profile, filename });
  } catch (error) {
    console.error('Failed to save profile:', error);
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

// API: List saved profiles
router.get('/api/profiles', async (req, res) => {
  try {
    const files = await fs.readdir(PROFILES_DIR);
    const profiles = await Promise.all(
      files
        .filter(f => f.endsWith('.json'))
        .map(async (file) => {
          const data = await fs.readFile(path.join(PROFILES_DIR, file), 'utf-8');
          const profile = JSON.parse(data);
          return {
            filename: file,
            ...profile
          };
        })
    );
    
    // Sort by timestamp (newest first)
    profiles.sort((a, b) => b.timestamp - a.timestamp);
    
    res.json(profiles);
  } catch (error) {
    console.error('Failed to list profiles:', error);
    res.status(500).json({ error: 'Failed to list profiles' });
  }
});

// API: Load profile as baseline
router.post('/api/profiles/baseline', async (req, res) => {
  try {
    const { filename } = req.body;
    
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    const filepath = path.join(PROFILES_DIR, filename);
    const data = await fs.readFile(filepath, 'utf-8');
    const profile = JSON.parse(data);

    metrics.setBaseline(profile);

    res.json({ success: true, baseline: profile.name });
  } catch (error) {
    console.error('Failed to load baseline:', error);
    res.status(500).json({ error: 'Failed to load baseline' });
  }
});

// API: Clear baseline
router.post('/api/profiles/baseline/clear', (req, res) => {
  metrics.setBaseline(null);
  res.json({ success: true });
});

// API: Get comparison with baseline
router.get('/api/comparison', (req, res) => {
  const comparison = metrics.getComparison();
  
  if (!comparison) {
    return res.json({ hasBaseline: false });
  }

  res.json({ hasBaseline: true, comparison });
});

// API: Delete profile
router.delete('/api/profiles/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filepath = path.join(PROFILES_DIR, filename);
    await fs.unlink(filepath);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete profile:', error);
    res.status(500).json({ error: 'Failed to delete profile' });
  }
});

export default router;
