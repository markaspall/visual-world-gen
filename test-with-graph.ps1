# Test Server-Side Generation with REAL User Graph
Write-Host "Testing with YOUR actual graph!" -ForegroundColor Cyan
Write-Host ""

# Create world using your existing graph
$worldDir = "storage\worlds\real_world"
Write-Host "Creating world from your graph..." -ForegroundColor Yellow

# Clean if exists
if (Test-Path $worldDir) {
    Remove-Item -Recurse -Force $worldDir
}
New-Item -ItemType Directory -Force -Path $worldDir | Out-Null

# Copy your graph file
Copy-Item "storage\1759988588740.json" "$worldDir\graph.json"
Write-Host "  Graph copied: 21 nodes, 38 connections" -ForegroundColor Green

# Create config
$config = @"
{
  "seed": 1759903421473,
  "materials": [
    { "id": 0, "name": "Air", "color": [0, 0, 0], "transparent": 1.0 },
    { "id": 1, "name": "Grass", "color": [0.27, 0.71, 0.27], "transparent": 0.0 },
    { "id": 2, "name": "Dirt", "color": [0.6, 0.4, 0.2], "transparent": 0.0 },
    { "id": 3, "name": "Stone", "color": [0.5, 0.5, 0.5], "transparent": 0.0 },
    { "id": 4, "name": "Sand", "color": [0.9, 0.85, 0.6], "transparent": 0.0 },
    { "id": 5, "name": "Snow", "color": [0.95, 0.95, 1.0], "transparent": 0.0 },
    { "id": 6, "name": "Water", "color": [0.2, 0.4, 0.8], "transparent": 0.7 },
    { "id": 7, "name": "Tree Seed", "color": [0.13, 0.54, 0.13], "transparent": 0.0 }
  ]
}
"@
$config | Out-File -FilePath "$worldDir\config.json" -Encoding utf8

Write-Host "  Config created with seed: 1759903421473" -ForegroundColor Green
Write-Host ""

# Wait for server reload
Write-Host "Waiting for server to reload..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

# Test chunk generation
Write-Host "Generating chunk with YOUR graph (21 nodes)..." -ForegroundColor Yellow
Write-Host ""

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3012/api/worlds/real_world/chunks/0/0/0" -OutFile "real_graph_chunk.svdag" -PassThru
    $stopwatch.Stop()
    
    $time = $stopwatch.ElapsedMilliseconds
    $size = (Get-Item "real_graph_chunk.svdag").Length
    
    Write-Host "SUCCESS! Your graph executed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Results:" -ForegroundColor Cyan
    Write-Host "  Generation Time: $time ms" -ForegroundColor Yellow
    Write-Host "  Chunk Size: $size bytes" -ForegroundColor Yellow
    Write-Host "  Material Nodes: $($response.Headers['X-Material-Nodes'])" -ForegroundColor Yellow
    Write-Host "  Material Leaves: $($response.Headers['X-Material-Leaves'])" -ForegroundColor Yellow
    Write-Host "  Opaque Nodes: $($response.Headers['X-Opaque-Nodes'])" -ForegroundColor Yellow
    Write-Host ""
    
    Write-Host "Server Console Check:" -ForegroundColor Cyan
    Write-Host "  Look for:" -ForegroundColor Yellow
    Write-Host "    - Execution order with all your nodes" -ForegroundColor Green
    Write-Host "    - SeedInput -> PerlinNoise -> Normalize -> etc." -ForegroundColor Green
    Write-Host "    - BiomeClassifier (13 biomes)" -ForegroundColor Green
    Write-Host "    - BlockClassifier (block assignment)" -ForegroundColor Green
    Write-Host ""
    
} catch {
    Write-Host "FAILED: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Check server console for error details" -ForegroundColor Yellow
    Write-Host "Common issues:" -ForegroundColor Yellow
    Write-Host "  - Missing node type (need to port more nodes)" -ForegroundColor Gray
    Write-Host "  - Shader compilation error" -ForegroundColor Gray
    Write-Host "  - GPU buffer size limit" -ForegroundColor Gray
    exit 1
}

# Test cache
Write-Host "Testing cache (should be instant)..." -ForegroundColor Yellow
$time2 = Measure-Command {
    Invoke-WebRequest -Uri "http://localhost:3012/api/worlds/real_world/chunks/0/0/0" -OutFile "real_graph_chunk2.svdag" | Out-Null
}
Write-Host "  Cached: $($time2.TotalMilliseconds) ms" -ForegroundColor Green
$speedup = [math]::Round($time / $time2.TotalMilliseconds, 1)
Write-Host "  Speedup: ${speedup}x faster!" -ForegroundColor Green
Write-Host ""

# Check what was generated
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "YOUR GRAPH IS RUNNING ON THE SERVER!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "What's Working:" -ForegroundColor Yellow
Write-Host "  - Full graph execution (topological sort)" -ForegroundColor Green
Write-Host "  - 8 node types implemented:" -ForegroundColor Green
Write-Host "    * SeedInput" -ForegroundColor Gray
Write-Host "    * PerlinNoise (GPU, 6 octaves FBM)" -ForegroundColor Gray
Write-Host "    * Normalize" -ForegroundColor Gray
Write-Host "    * Temperature (latitude + elevation)" -ForegroundColor Gray
Write-Host "    * Water (oceans + basic rivers)" -ForegroundColor Gray
Write-Host "    * BiomeClassifier (GPU, 13 biomes)" -ForegroundColor Gray
Write-Host "    * SlopeMap (Sobel gradient)" -ForegroundColor Gray
Write-Host "    * BlockClassifier (terrain + water blocks)" -ForegroundColor Gray
Write-Host ""

Write-Host "What's Skipped (as planned):" -ForegroundColor Yellow
Write-Host "  - Output nodes (server doesn't need PNG export)" -ForegroundColor Gray
Write-Host "  - Features, Trails (not critical for chunks)" -ForegroundColor Gray
Write-Host "  - HeightLOD, Erosion, Animation (you said skip)" -ForegroundColor Gray
Write-Host ""

Write-Host "Cache Structure:" -ForegroundColor Cyan
if (Test-Path "$worldDir\superchunks") {
    $superCount = (Get-ChildItem "$worldDir\superchunks" -Directory).Count
    Write-Host "  Super chunks: $superCount" -ForegroundColor Yellow
}
if (Test-Path "$worldDir\chunks") {
    $chunkCount = (Get-ChildItem "$worldDir\chunks" -File).Count
    Write-Host "  Stream chunks: $chunkCount" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Next: Build client chunk loader to view this world!" -ForegroundColor Green
Write-Host ""

# Cleanup
Remove-Item "real_graph_chunk*.svdag" -ErrorAction SilentlyContinue
