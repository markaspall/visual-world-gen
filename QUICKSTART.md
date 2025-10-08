# Quick Start Guide

## Getting Started

1. **Start the server**:
   ```bash
   npm start
   ```

2. **Open your browser**:
   Navigate to `http://localhost:3000`

3. **Check WebGPU support**:
   Look at the bottom-left status bar - it should show "✅ WebGPU Ready"

## Building Your First Pipeline

The application starts with a default pipeline already created. Here's how to modify and create your own:

### Basic Terrain Generation

**Goal**: Create a simple heightmap with multi-octave noise

1. The default graph already includes:
   - **Seed Input** → **Perlin Noise** → **Normalize** → **Depth Output**

2. **Select the Perlin Noise node** (click on it)
   - The middle column will show a preview
   - The Node Parameters panel appears below

3. **Tune the parameters**:
   - `frequency`: Controls the scale (try 2.0 for smaller features)
   - `octaves`: Number of noise layers (try 6 for more detail)
   - `persistence`: How much each octave contributes (0.5 is good)
   - `lacunarity`: Frequency multiplier per octave (2.0 is standard)

4. **Change the colormap** to "Terrain" to see elevation better

5. **Click "⚡ Generate"** to run the full pipeline
   - Results appear in the right column
   - Generation time is shown at the bottom

### Advanced Terrain with Features

**Goal**: Create realistic terrain with valleys, peaks, and varied elevation

1. **Clear the current graph**: Click "🗑️ Clear" (confirm the dialog)

2. **Add nodes** (click "➕ Add Node" for each):
   - **Seed Input** (x: 100, y: 100)
   - **Perlin Noise** - Base (x: 100, y: 200)
   - **Perlin Noise** - Detail (x: 100, y: 350)
   - **Perlin Noise** - Ridges (x: 100, y: 500)
   - **Combine** (x: 400, y: 350)
   - **Power** (x: 700, y: 350)
   - **Normalize** (x: 1000, y: 350)
   - **Depth Output** (x: 1300, y: 350)

3. **Connect the nodes**:
   - Seed → Base.seed
   - Seed → Detail.seed
   - Seed → Ridges.seed
   - Base → Combine.base
   - Detail → Combine.layer1
   - Ridges → Combine.layer2
   - Combine → Power.input
   - Power → Normalize.input
   - Normalize → Depth Output.input

4. **Configure each Perlin Noise node**:
   
   **Base** (large features):
   - frequency: 0.5
   - octaves: 4
   - persistence: 0.5

   **Detail** (small features):
   - frequency: 4.0
   - octaves: 6
   - persistence: 0.4

   **Ridges** (mountains):
   - frequency: 1.0
   - octaves: 5
   - persistence: 0.6

5. **Configure Combine**:
   - baseWeight: 1.0
   - layer1Weight: 0.3
   - layer2Weight: 0.5

6. **Configure Power**:
   - exponent: 1.5 (makes valleys deeper, peaks sharper)

7. **Generate** and view results!

### Terraced/Stepped Terrain

**Goal**: Create mesa-like stepped terrain

1. Take any existing heightmap pipeline and add:
   - **Terrace** node before the output
   
2. **Configure Terrace**:
   - steps: 8 (more steps = more terraces)
   - smoothness: 0.05 (lower = sharper steps)

### Creating Biomes

**Goal**: Classify terrain into biome types

1. Create a heightmap pipeline (as above)

2. Add:
   - **Classifier** node after Normalize
   - **Biome Output** node after Classifier

3. **Configure Classifier**:
   - thresholds: [0.2, 0.3, 0.4, 0.6, 0.8]
   - values: [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]

4. Connect: Normalize → Classifier → Biome Output

5. Generate and switch to the "Biome" tab in the output column

## Tips and Tricks

### Performance
- Start with 256x256 resolution for faster iteration
- Increase to 512x512 or higher for final generation
- 2048x2048 takes longer but produces high-quality maps

### Node Selection
- Click a node to preview its output in real-time
- Parameters update dynamically - changes trigger re-preview
- The preview shows only that node's output (not the full pipeline)

### Colormaps
- **Grayscale**: Raw values, good for debugging
- **Terrain**: Elevation colors (blue=low, green=mid, white=high)
- **Heat**: Good for moisture/temperature maps
- **Biome**: Discrete colors for classification

### Seed Management
- The Seed Input node lets you control randomness
- Same seed = same output (reproducible)
- Change seed value to get different variations
- Current seed is shown in the output info panel

### Saving and Loading
- **Save**: Stores your graph configuration (nodes, connections, parameters)
- **Load**: Lists all saved graphs - enter the number to load
- Saves are stored in `storage/` directory as JSON

### Exporting
- **Export PNG**: Downloads all generated maps as PNG files
- Files are named: `map-{type}-{seed}.png`
- PNG files use standard RGBA encoding

## Common Pipelines

### 1. Simple Noise
```
SeedInput → PerlinNoise → Normalize → DepthOutput
```

### 2. Layered Terrain
```
SeedInput → PerlinNoise(base) ──┐
         ↓                       ├→ Combine → Normalize → DepthOutput
         → PerlinNoise(detail) ─┘
```

### 3. Realistic Mountains
```
SeedInput → PerlinNoise → Power → Erosion → Normalize → DepthOutput
```

### 4. Masked Terrain (two biomes)
```
PerlinNoise(terrain1) ──┐
PerlinNoise(terrain2) ──┼→ Mask → DepthOutput
PerlinNoise(mask)     ──┘
```

### 5. Multi-Output
```
                    ┌→ Normalize → DepthOutput
SeedInput → Noise ──┤
                    └→ Classifier → BiomeOutput
```

## Troubleshooting

### "WebGPU Not Available"
- Use Chrome/Edge 113+ or newer
- Enable WebGPU in `chrome://flags` if needed
- Some browsers may not support WebGPU yet

### Preview Not Updating
- Make sure a node is selected (should have blue border)
- Check browser console for errors (F12)
- Try selecting a different node then back

### Generation Fails
- Check that all required inputs are connected
- Verify no cycles in the graph (circular connections)
- Look at console for specific error messages

### Slow Performance
- Lower resolution (256x256 is fast)
- Reduce octaves in Perlin Noise nodes
- Reduce iteration count in Erosion nodes

## Next Steps

- Experiment with different node combinations
- Try adjusting parameters to see their effects
- Create complex multi-layer terrains
- Export maps for use in game engines
- Build biome classification systems

## Advanced: RGBA Packing

For high-precision exports (future feature), maps can encode 16-bit or 32-bit values in RGBA channels:

- **16-bit height**: R=high byte, G=low byte, B/A=unused
- **32-bit float**: R/G/B/A = 4 bytes of float data

This allows heights up to 65,535 blocks as specified.
