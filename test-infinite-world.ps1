# Test Infinite World Viewer
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   Opening Infinite World Viewer..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$worldId = "real_world"
$url = "http://localhost:3012/worlds/$worldId/infinite"

Write-Host "World: $worldId" -ForegroundColor Yellow
Write-Host "URL: $url" -ForegroundColor Yellow
Write-Host ""

Write-Host "Features:" -ForegroundColor Green
Write-Host "  [+] Infinite world (load chunks on demand)" -ForegroundColor Gray
Write-Host "  [+] Multi-chunk SVDAG raymarching" -ForegroundColor Gray
Write-Host "  [+] Your 21-node graph running server-side" -ForegroundColor Gray
Write-Host "  [+] 13 biomes, rivers, procedural terrain" -ForegroundColor Gray
Write-Host "  [+] Smooth navigation with WASD + mouse" -ForegroundColor Gray
Write-Host ""

Write-Host "Controls:" -ForegroundColor Cyan
Write-Host "  W/A/S/D    - Move around" -ForegroundColor Gray
Write-Host "  Space      - Fly up" -ForegroundColor Gray
Write-Host "  Shift      - Fly down" -ForegroundColor Gray
Write-Host "  Mouse      - Look around (click canvas first)" -ForegroundColor Gray
Write-Host "  Esc        - Release mouse" -ForegroundColor Gray
Write-Host ""

Write-Host "Watch for:" -ForegroundColor Yellow
Write-Host "  - Initial chunk loading (first few seconds)" -ForegroundColor Gray
Write-Host "  - FPS counter (should be 60fps)" -ForegroundColor Gray
Write-Host "  - Chunks loaded counter (increases as you move)" -ForegroundColor Gray
Write-Host "  - Cache hits (should increase over time)" -ForegroundColor Gray
Write-Host ""

Write-Host "Performance Tips:" -ForegroundColor Cyan
Write-Host "  - First load: about 2s per chunk (generates terrain)" -ForegroundColor Gray
Write-Host "  - Cached: about 100ms per chunk (disk cache)" -ForegroundColor Gray
Write-Host "  - Chunks auto-load in 3-chunk radius" -ForegroundColor Gray
Write-Host "  - Max 100 chunks in memory at once" -ForegroundColor Gray
Write-Host ""

# Check if server is running
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3012" -Method HEAD -TimeoutSec 2 -ErrorAction Stop
    Write-Host "[OK] Server is running" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Server is NOT running!" -ForegroundColor Red
    Write-Host "  Start server with: npm run dev" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

# Check if world exists
$worldDir = "storage\worlds\$worldId"
if (Test-Path $worldDir) {
    Write-Host "[OK] World exists: $worldDir" -ForegroundColor Green
} else {
    Write-Host "[WARN] World not found, will be created on first chunk load" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Opening browser..." -ForegroundColor Cyan
Start-Process $url

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "INFINITE WORLD VIEWER OPENED!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "What to expect:" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Initial Load (5 to 10 seconds)" -ForegroundColor White
Write-Host "   - Loading about 20 chunks around spawn" -ForegroundColor Gray
Write-Host "   - Each chunk: server-side generation" -ForegroundColor Gray
Write-Host "   - Progress shown at bottom" -ForegroundColor Gray
Write-Host ""

Write-Host "2. First Render" -ForegroundColor White
Write-Host "   - Raymarched SVDAG terrain" -ForegroundColor Gray
Write-Host "   - Multiple chunks visible" -ForegroundColor Gray
Write-Host "   - 13 biomes with proper colors" -ForegroundColor Gray
Write-Host ""

Write-Host "3. Navigation" -ForegroundColor White
Write-Host "   - Click canvas to lock mouse" -ForegroundColor Gray
Write-Host "   - Move with WASD (smooth FPS controls)" -ForegroundColor Gray
Write-Host "   - Chunks load automatically as you explore" -ForegroundColor Gray
Write-Host ""

Write-Host "4. Performance" -ForegroundColor White
Write-Host "   - Should maintain 60 FPS" -ForegroundColor Gray
Write-Host "   - Chunks load in background (no stuttering)" -ForegroundColor Gray
Write-Host "   - Cache hits improve over time" -ForegroundColor Gray
Write-Host ""

Write-Host "Debug Info:" -ForegroundColor Cyan
Write-Host "  - Check browser console (F12) for chunk loading logs" -ForegroundColor Gray
Write-Host "  - Check server console for generation logs" -ForegroundColor Gray
Write-Host "  - Stats panel shows all relevant metrics" -ForegroundColor Gray
Write-Host ""

Write-Host "If something is wrong:" -ForegroundColor Yellow
Write-Host "  - Chunks not loading: Check server console for errors" -ForegroundColor Gray
Write-Host "  - Black screen: Open browser console (F12)" -ForegroundColor Gray
Write-Host "  - Low FPS: Reduce chunk load radius (edit worldInfinite.ejs)" -ForegroundColor Gray
Write-Host "  - Missing world: Run test-with-graph.ps1 first" -ForegroundColor Gray
Write-Host ""

Write-Host "Explore your infinite procedurally generated world!" -ForegroundColor Green
Write-Host ""
