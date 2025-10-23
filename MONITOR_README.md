# V2 Pipeline Monitoring Dashboard

Real-time performance monitoring for the V2 chunk generation pipeline.

## Features

### Overview Statistics
- **Uptime** - How long the server has been running
- **Total Chunks** - Total chunks generated + request rate
- **Cache Hit Rate** - Percentage of cached vs generated chunks
- **Avg Response Time** - Average and recent response times
- **Active Regions** - Number of regions in cache

### Real-Time Charts
- **Request Rate Chart** - Cached vs generated requests over time (10s intervals)
- **Response Time Distribution** - Pipeline stage timing breakdown

### Pipeline Stage Breakdown
Visual bars showing average time for each stage:
- Base Elevation (LOD 0)
- Pre-Erosion Moisture
- Hydraulic Erosion
- Post-Erosion Moisture
- Upscale (128→512)
- Chunk Generation
- SVDAG Compression

### Recent Requests Table
Last 20 requests showing:
- Timestamp
- Chunk coordinates
- Cached/Generated status
- Total time and per-stage timing

## Usage

### 1. Start the Main Server

```bash
npm start
```

The monitor is integrated into the main server (port 3012).

### 2. Open Dashboard

Navigate to: **http://localhost:3012/monitor**

### 3. Generate Chunks

Visit the world:
**http://localhost:3012/world**

As you move around, chunks will be requested and the monitor will update in real-time!

### 4. Reset Metrics

Click the **🔄 Reset** button to clear all statistics and start fresh.

## Architecture

### Metrics Collection

The monitor uses an in-memory metrics collector (`server/routes/monitor.js`) that records:
- Request timing
- Cache hits/misses
- Pipeline stage breakdown
- Region statistics

### Data Flow

```
V2 Chunk Request
    ↓
chunksv2.js generates chunk (same process)
    ↓
Records metrics via metrics.recordRequest() (shared memory)
    ↓
Monitor API serves data at /monitor/api/stats
    ↓
Dashboard polls every 1 second
    ↓
Charts update in real-time
```

**Note:** The monitor routes are mounted on the main server, so they share the same process and memory space. This allows `chunksv2.js` to directly record metrics that the monitor dashboard can access.

### Files

- `server/routes/monitor.js` - Metrics collector & API routes (integrated into main server)
- `views/monitor.ejs` - Dashboard HTML
- `public/css/monitor.css` - Dashboard styles
- `public/js/monitor.js` - Dashboard JavaScript + Chart.js
- `server/monitorServer.js` - Optional standalone server (not needed, main server has monitor)

## Metrics API

### GET /monitor/api/stats

Returns current statistics:

```json
{
  "uptime": {
    "ms": 123456,
    "formatted": "2m 3s"
  },
  "chunks": {
    "total": 150,
    "cached": 50,
    "generated": 100,
    "cacheHitRate": "33.3",
    "requestRate": "2.5"
  },
  "timings": {
    "total": {
      "avg": 45.2,
      "recent": 42.1,
      "min": 38.0,
      "max": 78.5,
      "count": 150
    },
    "chunkGen": { ... },
    "svdagBuild": { ... }
  },
  "regions": {
    "total": 3,
    "list": [...]
  },
  "recentRequests": [...]
}
```

### GET /monitor/api/timeseries?minutes=5

Returns time series data (10s buckets):

```json
[
  {
    "timestamp": 1729650000000,
    "count": 15,
    "cached": 5,
    "generated": 10,
    "avgTime": 43.2
  },
  ...
]
```

### POST /monitor/api/reset

Resets all metrics.

## Performance Notes

- **Update Interval**: Dashboard polls every 1 second
- **History**: Keeps last 1000 requests in memory
- **Charts**: Last 500 timing samples
- **Time Series**: Last 5 minutes (configurable via query param)

## Future Enhancements

### When GPU Pipeline is Active
Once the full GPU pipeline is implemented, the monitor will show:
- Base Elevation timing
- Pre-Erosion Moisture timing
- Erosion timing (per iteration)
- Post-Erosion Moisture timing
- Upscale timing
- More detailed region generation stats

### Planned Features
- [ ] Export metrics to CSV
- [ ] Configurable alert thresholds
- [ ] Memory usage tracking
- [ ] Network bandwidth monitoring
- [ ] Historical data persistence
- [ ] Multi-server aggregation

## Troubleshooting

### Dashboard shows "Connecting..."
- Ensure main server is running (`npm start`)
- Check browser console for errors
- Verify you're accessing `http://localhost:3012/monitor`

### No data appearing
- Generate chunks by visiting `http://localhost:3012/world`
- Move around in the world to trigger chunk requests
- Ensure V2 route is being used (check response headers for `X-Pipeline-Version: v2`)
- Check server logs for errors

### Charts not updating
- Check browser console for fetch errors
- Verify `/monitor/api/stats` endpoint is accessible (should return JSON)
- Try hard-refreshing the page (Ctrl+Shift+R)

## Development

To add new metrics:

1. Update `MetricsCollector` in `server/routes/monitor.js`
2. Record data in `chunksv2.js` via `metrics.recordRequest()`
3. Update dashboard UI in `views/monitor.ejs`
4. Add visualization in `public/js/monitor.js`

## License

MIT
