# Visual World Generator

A browser-based procedural map generation system using WebGPU for real-time terrain generation.

## Features

- **WebGPU-Accelerated**: All compute-intensive operations run on GPU
- **Three-Column Layout**:
  - Node/Graph Editor: Build your procedural generation pipeline
  - Intermediary Preview: See results at each stage for fine-tuning
  - Final Outputs: View all generated maps (depth, biome, water, etc.)
- **Node-Based System**: Modular pipeline with reusable nodes
- **Real-Time Visualization**: Instant feedback with multiple colormaps
- **PNG Export**: Export maps with RGBA data packing

## Requirements

- Modern browser with WebGPU support:
  - Chrome/Edge 113+
  - Chromium-based browsers with WebGPU enabled
- Node.js 16+ (for running the server)

## Installation

```bash
npm install
```

## Running

```bash
npm start
```

Then open http://localhost:3000 in your browser.

## Usage

### Creating a Pipeline

1. Click "➕ Add Node" to add nodes to the graph
2. Click and drag from output sockets (right side) to input sockets (left side) to create connections
3. Select a node to preview its output in the middle column
4. Click "⚡ Generate" to execute the full pipeline
5. View results in the right column, switching between map types using the tabs

### Available Nodes

#### Sources
- **Seed Input**: Provides seed value for reproducible generation
- **Perlin Noise**: Generates multi-octave Perlin noise

#### Operators
- **Blend**: Combines two inputs (add, multiply, lerp, etc.)
- **Normalize**: Normalizes data to specified range
- **Remap**: Remaps values from one range to another

#### Processors
- **Erosion**: Simulates hydraulic erosion on heightmaps
- **Classifier**: Classifies values into discrete categories

#### Outputs
- **Depth Output**: Marks data as elevation/heightmap
- **Biome Output**: Marks data as biome classification
- **Water Output**: Marks data as water level

### Example Pipeline

A basic terrain generation pipeline:

```
SeedInput → PerlinNoise → Normalize → DepthOutput
```

### Saving and Loading

- **Save**: Saves the current graph configuration
- **Load**: Load a previously saved graph
- **Export PNG**: Exports all generated maps as PNG files

## Architecture

- **Frontend**: Vanilla JavaScript with WebGPU
- **Backend**: Express.js + EJS for serving and storage
- **Compute**: WGSL compute shaders for GPU processing
- **Rendering**: Canvas 2D for visualization

## Project Structure

```
visual-world-gen/
├── server.js              # Express server
├── views/
│   └── index.ejs         # Main HTML template
├── public/
│   ├── css/
│   │   ├── style.css     # Main styles
│   │   └── rete.css      # Node editor styles
│   └── js/
│       ├── main.js       # Application entry point
│       ├── webgpu.js     # WebGPU context and utilities
│       ├── nodeEditor.js # Custom node editor
│       ├── visualizer.js # Canvas rendering and colormaps
│       ├── pipeline.js   # Pipeline execution manager
│       └── nodes/        # Node implementations
│           ├── BaseNode.js
│           ├── PerlinNoiseNode.js
│           ├── NormalizeNode.js
│           └── ...
└── storage/              # Saved graphs (created on first save)
```

## Extending

### Adding New Nodes

1. Create a new file in `public/js/nodes/` (e.g., `MyNode.js`)
2. Extend `BaseNode` class
3. Define `static inputs`, `outputs`, and `defaultParams`
4. Implement `async process(inputs, params)` method
5. Register in `pipeline.js`:

```javascript
import { MyNode } from './nodes/MyNode.js';
// ...
this.nodeTypes.set('MyNode', MyNode);
```

6. Add to modal in `views/index.ejs`:

```html
<button class="node-type-btn" data-type="MyNode">My Node</button>
```

## Performance

- Default resolution: 512x512 (adjustable)
- Generation time: <1s for basic pipelines on modern GPU
- Max resolution: 4096x4096 (as per spec)

## Roadmap

- [ ] Pathfinding node for rivers/trails
- [ ] Hierarchy builder for LOD maps
- [ ] Advanced erosion simulation
- [ ] Feature placement node
- [ ] 3D preview with cave carving
- [ ] Biome classification with multiple inputs
- [ ] Node parameter UI in the editor
- [ ] Undo/redo functionality
- [ ] Graph zoom and pan

## License

MIT
