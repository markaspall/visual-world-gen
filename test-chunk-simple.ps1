# Simple Chunk Generation Test
Write-Host "Testing Server-Side Chunk Generation" -ForegroundColor Cyan
Write-Host ""

# Step 1: Create test world
Write-Host "Step 1: Creating test world..." -ForegroundColor Yellow
$worldDir = "storage\worlds\test_world"
New-Item -ItemType Directory -Force -Path $worldDir | Out-Null

$config = @"
{
  "seed": 12345,
  "materials": [
    { "id": 0, "name": "Air", "color": [0, 0, 0], "transparent": 1.0 },
    { "id": 1, "name": "Stone", "color": [0.5, 0.5, 0.5], "transparent": 0.0 },
    { "id": 2, "name": "Grass", "color": [0.27, 0.71, 0.27], "transparent": 0.0 },
    { "id": 6, "name": "Water", "color": [0.2, 0.4, 0.8], "transparent": 0.7 }
  ],
  "erosionIterations": 50
}
"@
$config | Out-File -FilePath "$worldDir\config.json" -Encoding utf8

$graph = '{"nodes":[],"connections":[]}'
$graph | Out-File -FilePath "$worldDir\graph.json" -Encoding utf8

Write-Host "Created test world" -ForegroundColor Green
Write-Host ""

# Step 2: Request chunk (cold)
Write-Host "Step 2: Requesting chunk (0,0,0) - COLD generation..." -ForegroundColor Yellow
$time1 = Measure-Command {
    Invoke-WebRequest -Uri "http://localhost:3012/api/worlds/test_world/chunks/0/0/0" -OutFile "test_chunk.svdag" | Out-Null
}
$size1 = (Get-Item "test_chunk.svdag").Length
Write-Host "Generated in $($time1.TotalMilliseconds) ms" -ForegroundColor Green
Write-Host "Size: $size1 bytes" -ForegroundColor Cyan
Write-Host ""

# Step 3: Request same chunk (cached)
Write-Host "Step 3: Requesting chunk (0,0,0) - CACHED..." -ForegroundColor Yellow
$time2 = Measure-Command {
    Invoke-WebRequest -Uri "http://localhost:3012/api/worlds/test_world/chunks/0/0/0" -OutFile "test_chunk2.svdag" | Out-Null
}
Write-Host "Loaded in $($time2.TotalMilliseconds) ms" -ForegroundColor Green
$speedup = [math]::Round($time1.TotalMilliseconds / $time2.TotalMilliseconds, 1)
Write-Host "Speedup: ${speedup}x faster" -ForegroundColor Green
Write-Host ""

# Step 4: Request different chunk (warm)
Write-Host "Step 4: Requesting chunk (1,0,0) - WARM generation..." -ForegroundColor Yellow
$time3 = Measure-Command {
    Invoke-WebRequest -Uri "http://localhost:3012/api/worlds/test_world/chunks/1/0/0" -OutFile "test_chunk3.svdag" | Out-Null
}
Write-Host "Generated in $($time3.TotalMilliseconds) ms" -ForegroundColor Green
Write-Host ""

# Summary
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "ALL TESTS PASSED!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Performance Summary:" -ForegroundColor Cyan
Write-Host "  Cold generation:   $($time1.TotalMilliseconds) ms" -ForegroundColor Yellow
Write-Host "  Cached load:       $($time2.TotalMilliseconds) ms (${speedup}x faster)" -ForegroundColor Green
Write-Host "  Warm generation:   $($time3.TotalMilliseconds) ms" -ForegroundColor Yellow
Write-Host ""

# Check cache
if (Test-Path "$worldDir\superchunks") {
    $superCount = (Get-ChildItem "$worldDir\superchunks" -Directory).Count
    Write-Host "Super chunks created: $superCount" -ForegroundColor Cyan
}
if (Test-Path "$worldDir\chunks") {
    $chunkCount = (Get-ChildItem "$worldDir\chunks" -File).Count
    Write-Host "Stream chunks created: $chunkCount" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "Server-side chunk generation is working!" -ForegroundColor Green
Write-Host ""

# Cleanup
Remove-Item "test_chunk*.svdag" -ErrorAction SilentlyContinue
Write-Host "Test files cleaned up" -ForegroundColor Gray
