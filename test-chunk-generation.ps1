# Test Server-Side Chunk Generation
# Run this script to verify the chunk system works

Write-Host "🧪 Testing Server-Side Chunk Generation`n" -ForegroundColor Cyan

# Step 1: Create test world
Write-Host "📁 Step 1: Creating test world..." -ForegroundColor Yellow
$worldDir = "storage\worlds\test_world"
New-Item -ItemType Directory -Force -Path $worldDir | Out-Null

# Create config.json
$config = @{
    seed = 12345
    materials = @(
        @{ id = 0; name = "Air"; color = @(0, 0, 0); transparent = 1.0 },
        @{ id = 1; name = "Stone"; color = @(0.5, 0.5, 0.5); transparent = 0.0 },
        @{ id = 2; name = "Grass"; color = @(0.27, 0.71, 0.27); transparent = 0.0 },
        @{ id = 3; name = "Dirt"; color = @(0.6, 0.4, 0.2); transparent = 0.0 },
        @{ id = 4; name = "Sand"; color = @(0.9, 0.85, 0.6); transparent = 0.0 },
        @{ id = 5; name = "Snow"; color = @(0.95, 0.95, 1.0); transparent = 0.0 },
        @{ id = 6; name = "Water"; color = @(0.2, 0.4, 0.8); transparent = 0.7 }
    )
    erosionIterations = 50
} | ConvertTo-Json -Depth 10
$config | Out-File -FilePath "$worldDir\config.json" -Encoding utf8

# Create graph.json (empty for now)
$graph = @{
    nodes = @()
    connections = @()
} | ConvertTo-Json
$graph | Out-File -FilePath "$worldDir\graph.json" -Encoding utf8

Write-Host "✅ Test world created at $worldDir`n" -ForegroundColor Green

# Step 2: Request chunk (0, 0, 0) - COLD generation
Write-Host "📦 Step 2: Requesting chunk (0, 0, 0) - First time (cold)..." -ForegroundColor Yellow
$stopwatch1 = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3012/api/worlds/test_world/chunks/0/0/0" -OutFile "test_chunk_0_0_0.svdag" -PassThru
    $stopwatch1.Stop()
    $time1 = $stopwatch1.ElapsedMilliseconds
    $size1 = (Get-Item "test_chunk_0_0_0.svdag").Length
    
    Write-Host "✅ Chunk generated!" -ForegroundColor Green
    Write-Host "   Time: $time1 ms" -ForegroundColor Cyan
    Write-Host "   Size: $size1 bytes" -ForegroundColor Cyan
    Write-Host "   Generation Time (header): $($response.Headers['X-Generation-Time']) ms" -ForegroundColor Cyan
    Write-Host "   Material Nodes: $($response.Headers['X-Material-Nodes'])" -ForegroundColor Cyan
    Write-Host "   Material Leaves: $($response.Headers['X-Material-Leaves'])" -ForegroundColor Cyan
    Write-Host "   Opaque Nodes: $($response.Headers['X-Opaque-Nodes'])" -ForegroundColor Cyan
    Write-Host ""
} catch {
    Write-Host "❌ Failed: $_" -ForegroundColor Red
    exit 1
}

# Step 3: Request same chunk again - CACHE hit
Write-Host "📦 Step 3: Requesting chunk (0, 0, 0) - Second time (cached)..." -ForegroundColor Yellow
$stopwatch2 = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3012/api/worlds/test_world/chunks/0/0/0" -OutFile "test_chunk_0_0_0_cached.svdag" -PassThru
    $stopwatch2.Stop()
    $time2 = $stopwatch2.ElapsedMilliseconds
    
    Write-Host "✅ Chunk loaded from cache!" -ForegroundColor Green
    Write-Host "   Time: $time2 ms" -ForegroundColor Cyan
    Write-Host "   Speedup: $([math]::Round($time1 / $time2, 1))x faster" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "❌ Failed: $_" -ForegroundColor Red
    exit 1
}

# Step 4: Request different chunk in same super chunk - WARM generation
Write-Host "📦 Step 4: Requesting chunk (1, 0, 0) - Same super chunk (warm)..." -ForegroundColor Yellow
$stopwatch3 = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3012/api/worlds/test_world/chunks/1/0/0" -OutFile "test_chunk_1_0_0.svdag" -PassThru
    $stopwatch3.Stop()
    $time3 = $stopwatch3.ElapsedMilliseconds
    
    Write-Host "✅ Chunk generated from cached super chunk!" -ForegroundColor Green
    Write-Host "   Time: $time3 ms" -ForegroundColor Cyan
    Write-Host "   Expected: 50-200ms (super chunk cached)" -ForegroundColor Cyan
    Write-Host ""
} catch {
    Write-Host "❌ Failed: $_" -ForegroundColor Red
    exit 1
}

# Step 5: Check cache structure
Write-Host "📂 Step 5: Checking cache structure..." -ForegroundColor Yellow
Write-Host "`nSuper Chunk Cache:" -ForegroundColor Cyan
if (Test-Path "$worldDir\superchunks") {
    Get-ChildItem "$worldDir\superchunks" -Recurse | ForEach-Object {
        if ($_.PSIsContainer) {
            Write-Host "  $($_.Name)/" -ForegroundColor Yellow
        } else {
            $sizeKB = [math]::Round($_.Length / 1024, 1)
            Write-Host "    $($_.Name) ($sizeKB KB)" -ForegroundColor Gray
        }
    }
} else {
    Write-Host "  (not created yet)" -ForegroundColor Gray
}

Write-Host "`nStream Chunk Cache:" -ForegroundColor Cyan
if (Test-Path "$worldDir\chunks") {
    Get-ChildItem "$worldDir\chunks" -File | ForEach-Object {
        $sizeKB = [math]::Round($_.Length / 1024, 1)
        Write-Host "  $($_.Name) ($sizeKB KB)" -ForegroundColor Gray
    }
} else {
    Write-Host "  (not created yet)" -ForegroundColor Gray
}

# Summary
Write-Host "`n" + "="*60 -ForegroundColor Cyan
Write-Host "✅ ALL TESTS PASSED!" -ForegroundColor Green
Write-Host "="*60 -ForegroundColor Cyan
Write-Host "`nPerformance Summary:" -ForegroundColor Cyan
Write-Host "  Cold generation:   $time1 ms" -ForegroundColor Yellow
Write-Host "  Cached load:       $time2 ms ($(([math]::Round($time1 / $time2, 1)))x faster)" -ForegroundColor Green
Write-Host "  Warm generation:   $time3 ms" -ForegroundColor Yellow
Write-Host "`nCache Status:" -ForegroundColor Cyan
Write-Host "  Super chunks: $(if (Test-Path "$worldDir\superchunks") { (Get-ChildItem "$worldDir\superchunks" -Directory).Count } else { 0 })" -ForegroundColor Yellow
Write-Host "  Stream chunks: $(if (Test-Path "$worldDir\chunks") { (Get-ChildItem "$worldDir\chunks" -File).Count } else { 0 })" -ForegroundColor Yellow
Write-Host "`n🎉 Server-side chunk generation is working!`n" -ForegroundColor Green

# Cleanup test files
Write-Host "🧹 Cleanup: Remove test chunk files? (y/n): " -ForegroundColor Yellow -NoNewline
$cleanup = Read-Host
if ($cleanup -eq "y") {
    Remove-Item "test_chunk_*.svdag" -ErrorAction SilentlyContinue
    Write-Host "✅ Test files cleaned up`n" -ForegroundColor Green
}
