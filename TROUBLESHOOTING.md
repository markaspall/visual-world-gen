# Troubleshooting Guide

## Server Issues

### Server won't start
```bash
# Check if port 3000 is already in use
netstat -ano | findstr :3000

# Kill the process if needed
taskkill /PID <process_id> /F

# Or use a different port by editing server.js:
const PORT = 3001;  // Change this line
```

### Can't access http://localhost:3000
1. Check if server is running (should see console output)
2. Try http://127.0.0.1:3000 instead
3. Check Windows Firewall settings
4. Look for error messages in the terminal

## WebGPU Issues

### "WebGPU is not supported"

**Solution 1: Update Browser**
- Use Chrome 113+ or Edge 113+
- Check version: Settings → About Chrome/Edge
- Update if needed

**Solution 2: Enable WebGPU Flag**
1. Open `chrome://flags` (or `edge://flags`)
2. Search for "WebGPU"
3. Enable "Unsafe WebGPU"
4. Relaunch browser

**Solution 3: Check GPU Drivers**
- Update your graphics drivers to latest version
- Restart computer after update

**Solution 4: Check GPU Compatibility**
```javascript
// Open DevTools Console (F12) and run:
navigator.gpu ? 'WebGPU API Available' : 'WebGPU Not Available'

// If available, check adapter:
const adapter = await navigator.gpu.requestAdapter();
console.log(adapter);
```

### WebGPU crashes or errors

**Check Console Errors**:
- Press F12 to open DevTools
- Look for red error messages
- Common issues:
  - Buffer size limits exceeded
  - Shader compilation errors
  - Out of memory

**Reduce Load**:
- Lower resolution to 256x256
- Reduce octaves in Perlin Noise (try 2-3)
- Simplify pipeline (fewer nodes)

## Node Editor Issues

### Can't see nodes
- Check if canvas is rendering (should see grid)
- Try resizing window
- Check browser console for errors
- Refresh page (Ctrl+R)

### Can't connect nodes
1. **Drag from output (right) to input (left)**
   - Not the other way around
2. **Check socket types match**
   - Some nodes require specific inputs
3. **Look for connection line appearing**
   - Should see bezier curve while dragging

### Node won't execute
- **Check all required inputs are connected**
  - Red errors in console will say which inputs are missing
- **Verify no cycles in graph**
  - Can't connect node back to itself
- **Check parameter values**
  - Some values (like 0 octaves) cause errors

### Preview not updating
1. **Node must be selected** (blue border)
2. **Click node again** to refresh
3. **Check middle column** for error messages
4. **Try different node** to isolate issue

### Parameters not appearing
- Only selected node shows parameters
- Some nodes have no parameters (output nodes)
- Refresh preview by reselecting node

## Generation Issues

### "Generation failed" error
1. **Open DevTools Console** (F12)
2. **Read the error message**
3. Common causes:
   - Missing required input
   - Invalid parameter value
   - Cycle in graph
   - GPU out of memory

### Generation is very slow
**Immediate fixes**:
- Lower resolution (256x256)
- Reduce node count
- Simplify parameters

**Long-term optimizations**:
- Reduce octaves in noise nodes (4-6 is plenty)
- Lower erosion iterations (10-50 is often enough)
- Use Combine instead of multiple Blend nodes

### Output is all black/white
- **Check Normalize node** is in pipeline
- **Verify data range** in preview stats
- **Try different colormap**
- **Check if data is actually generating** (preview upstream nodes)

### Output looks wrong
1. **Preview each node** to find where it goes wrong
2. **Check parameters** - small changes make big differences
3. **Verify connections** - wrong input order matters
4. **Try simpler pipeline first** to isolate issue

## Visualization Issues

### Canvas is blank
- **Check WebGPU status** (bottom-left)
- **Verify generation completed**
- **Try different colormap**
- **Check canvas size** in DevTools

### Colors look weird
- **Change colormap** dropdown
- **Terrain** is best for heightmaps
- **Grayscale** for debugging
- **Check data range** in stats

### Preview is pixelated (intended)
- This is correct behavior for pixel art style
- Shows actual data without interpolation
- Change CSS if you want smoothing:
  ```css
  #preview-canvas {
    image-rendering: auto; /* Instead of pixelated */
  }
  ```

## Save/Load Issues

### Can't save
- **Check storage folder exists** (created automatically)
- **Check disk space**
- **Look for permissions errors** in server console
- **Try different filename/ID**

### Can't load
- **Check saved file exists** in storage/
- **Verify JSON is valid** (not corrupted)
- **Try loading different file**
- **Check server console** for errors

### Lost work
- Graphs save to `storage/` folder
- Check there if app closed unexpectedly
- Files are JSON (can edit manually if needed)

## Export Issues

### Export doesn't download
1. **Check browser popup blocker**
2. **Allow downloads** from localhost
3. **Check Downloads folder** (may be there)
4. **Try one map at a time** instead of all

### PNG looks wrong
- **Verify generation completed** first
- **Check which tab is active** (exports current view)
- **Try different colormap** before export
- **Check file actually downloaded** (not 0 bytes)

## Performance Issues

### UI is laggy
- **Close other tabs/apps**
- **Lower resolution**
- **Disable preview auto-update** (manual refresh)
- **Simplify graph** (fewer nodes)

### Browser freezes
- **Reduce resolution** significantly
- **Don't spam Generate button**
- **Wait for current operation** to finish
- **Check GPU usage** in Task Manager

### Memory errors
- **Refresh page** to clear memory
- **Lower resolution** permanently
- **Simplify pipeline**
- **Close other browser tabs**

## Common Error Messages

### "process() must be implemented"
- Node class not properly set up
- Check node file exists
- Verify import in pipeline.js

### "requires input"
- Input socket not connected
- Connect required input or provide default

### "Cycle detected in graph"
- Graph has circular connection
- Remove connection that loops back

### "Unknown node type"
- Node not registered in pipeline.js
- Check spelling in modal button data-type

### "Buffer size exceeds limit"
- Resolution too high for GPU
- Lower resolution or reduce data size

## Debug Mode

**Enable verbose logging**:
```javascript
// Add to main.js at top
window.DEBUG = true;

// Then nodes will log more info
console.log('Debug mode enabled');
```

**Test individual node**:
```javascript
// In DevTools Console
const node = new PerlinNoiseNode(app.gpu);
const result = await node.process({}, {
  resolution: 256,
  seed: 12345,
  frequency: 1,
  octaves: 4,
  persistence: 0.5,
  lacunarity: 2
});
console.log('Result:', result);
```

## Getting Help

### Information to provide:
1. **Browser version** (chrome://version)
2. **WebGPU status** (from app status bar)
3. **Console errors** (F12 → Console tab)
4. **What you were doing** when error occurred
5. **Can you reproduce it?** (steps to reproduce)

### Before reporting:
1. Check this guide
2. Check README.md and QUICKSTART.md
3. Try in fresh browser window (incognito)
4. Try with simpler pipeline
5. Check if others have same issue

## Still Having Issues?

### Quick Reset:
1. Refresh page (Ctrl+Shift+R for hard refresh)
2. Clear all nodes
3. Create simple test pipeline:
   - Seed → Perlin → Normalize → Depth
4. Set resolution to 256x256
5. Click Generate

If this works, issue is with your specific pipeline/parameters.
If this fails, issue is environmental (WebGPU, browser, GPU, etc.).

### Nuclear Option:
```bash
# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Or on Windows:
rmdir /s /q node_modules
del package-lock.json
npm install
```

---

**Most issues are resolved by:**
1. Using Chrome 113+
2. Reducing resolution to 256x256
3. Checking all inputs are connected
4. Reading console errors
5. Refreshing the page
