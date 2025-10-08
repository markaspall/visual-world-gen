# Controls and Navigation

## Node Graph Controls

### Zoom
- **Mouse Wheel**: Scroll up to zoom in, scroll down to zoom out
- **Zoom Range**: 10% to 300%
- **Zoom Point**: Always zooms toward your mouse cursor position

### Pan
- **Space + Left Click Drag**: Hold spacebar, then click and drag
- **Middle Mouse Button**: Click and drag with middle mouse button
- **Cursor Changes**: 
  - `grab` cursor when space is held
  - `grabbing` cursor when panning

### Node Operations
- **Select Node**: Left click on any node
- **Move Node**: Click and drag a node (works while zoomed/panned)
- **Create Connection**: 
  - Click and drag from an output socket (right side)
  - Release on an input socket (left side)
  - Works across zoom levels

### Tips
- Use zoom to get a better view of complex graphs
- Pan to organize nodes across large canvas space
- Zoom out to see the full pipeline
- Zoom in for precise connection work

## Parameter Panel (Bottom)

### Editing Parameters
- **Sliders**: Drag to adjust values in real-time
- **Value Display**: Shows current value next to each slider
- **Live Feedback**: Values update as you drag (darker numbers)
- **Preview Update**: Release slider to trigger preview refresh

### Slider Ranges
- **Octaves**: 1-12 (integer)
- **Frequency/Scale**: 0.1-10 (decimal)
- **Persistence/Weights**: 0-1 (decimal)
- **Lacunarity**: 1-4 (decimal)
- **Steps**: 2-20 (integer)
- **Iterations**: 1-200 (integer)
- **Rates/Smoothness**: 0-1 (decimal)

### Parameter Types
- **Sliders**: Numeric values with visual feedback
- **Text Inputs**: For string values (e.g., operation names)
- **Array Inputs**: Comma-separated values (e.g., thresholds)

## Preview Column (Middle)

### Colormap Selection
- **Grayscale**: Raw data values (good for debugging)
- **Terrain**: Elevation-based colors (blue → green → brown → white)
- **Heat**: Temperature-style gradient (black → red → yellow → white)
- **Biome**: Discrete categorical colors

### Resolution
- **256x256**: Fastest, good for quick iteration
- **512x512**: Default, balanced speed/detail
- **1024x1024**: High detail, slower
- **2048x2048**: Maximum detail, slowest

### Statistics
- **Min**: Lowest value in data
- **Max**: Highest value in data
- **Mean**: Average value
- **Size**: Grid resolution

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Enter pan mode (hold) |
| `Space + Drag` | Pan canvas |
| `Scroll` | Zoom in/out |
| `Delete` | Delete selected node |

## Mouse Controls

| Action | Result |
|--------|--------|
| Left Click Node | Select node |
| Left Drag Node | Move node |
| Double Click Node Title | Rename node |
| Left Drag Socket | Create connection |
| Right Click Node | Delete node (with confirmation) |
| Right Click Connection | Delete connection (with confirmation) |
| Space + Left Drag | Pan canvas |
| Shift + Left Drag | Pan canvas |
| Middle Mouse Drag | Pan canvas |
| Scroll Wheel | Zoom |

## Status Bar

### Left Side
- **WebGPU Status**: Shows if GPU acceleration is available
- **Zoom Info**: Current zoom level and control hints

### Right Side
- **Generation Status**: Current operation status

## Advanced Navigation

### Finding Nodes
1. Zoom out fully (scroll down repeatedly)
2. See entire graph at once
3. Zoom in to specific area of interest

### Complex Graphs
1. Organize nodes in columns (inputs → processing → outputs)
2. Use zoom to work on specific sections
3. Pan between sections as needed
4. Zoom out periodically to maintain overview

### Best Practices
- **Start Zoomed Out**: Get the big picture first
- **Zoom In for Details**: When editing specific nodes
- **Use Grid**: Align nodes to grid for clean layout
- **Space Nodes Out**: Leave room for connections
- **Group Related Nodes**: Keep processing chains together

## Parameter Editing Workflow

1. **Select Node**: Click the node in the graph
2. **Check Parameters**: Look at bottom parameter panel
3. **Adjust Sliders**: Drag to desired values
4. **Watch Preview**: Middle column updates automatically
5. **Fine-Tune**: Make small adjustments
6. **Generate**: When satisfied, hit Generate button

## Multi-Octave Noise Control

Since each Perlin Noise node has fixed octave settings, create layered detail by:

1. **Create Multiple Perlin Nodes**:
   - Node 1: Low frequency (0.5), few octaves (2) = Base terrain
   - Node 2: Mid frequency (2.0), moderate octaves (4) = Medium detail
   - Node 3: High frequency (8.0), many octaves (6) = Fine detail

2. **Combine with Weights**:
   - Use Combine node
   - baseWeight: 1.0 (dominant)
   - layer1Weight: 0.5 (moderate)
   - layer2Weight: 0.25 (subtle)

3. **Adjust Individual Layers**:
   - Each layer has full parameter control
   - Independently tune frequency, persistence, lacunarity
   - Preview each node separately to see contribution

This gives you more control than a single multi-octave node!

## Troubleshooting Navigation

### Canvas Won't Pan
- Make sure you're holding Space or using middle mouse
- Check that you're not dragging a node instead
- Try refreshing the page

### Zoom Feels Wrong
- Zoom follows mouse cursor - move mouse to desired area first
- If zoomed too far, scroll opposite direction
- Reset by refreshing page (starts at 100%)

### Can't See Nodes
- You may be zoomed in too far - scroll out
- Or panned off-screen - try Space+Drag to find them
- Refresh page to reset view

### Connections Won't Draw
- Make sure you're in world space (not panning)
- Release Space before creating connections
- Zoom level doesn't matter for connections
