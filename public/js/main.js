import { WebGPUContext } from './webgpu.js';
import { NodeEditor } from './nodeEditor.js';
import { Visualizer } from './visualizer.js';
import { PipelineManager } from './pipeline.js';

class App {
  constructor() {
    this.gpu = null;
    this.visualizer = null;
    this.pipeline = null;
    
    this.elements = {
      gpuStatus: document.getElementById('gpu-status'),
      generationStatus: document.getElementById('generation-status'),
      btnGenerate: document.getElementById('btn-generate'),
      btnSave: document.getElementById('btn-save'),
      btnLoad: document.getElementById('btn-load'),
      btnExport: document.getElementById('btn-export'),
      autoGenerate: document.getElementById('auto-generate'),
      outputTabs: document.querySelectorAll('#output-tabs .tab'),
      previewCanvas: document.getElementById('preview-canvas'),
      outputCanvas: document.getElementById('output-canvas'),
      outputTime: document.getElementById('output-time'),
      outputResolution: document.getElementById('output-resolution'),
      outputSeed: document.getElementById('output-seed')
    };
    
    this.currentOutputMap = 'depth';
    this.autoGenerateInterval = null;
    this.lastGraphHash = null;
  }

  async init() {
    console.log('Initializing Visual World Generator...');
    
    // Initialize WebGPU
    this.updateStatus('Initializing WebGPU...', 'loading');
    try {
      this.gpu = new WebGPUContext();
      await this.gpu.init();
      this.elements.gpuStatus.textContent = '✅ WebGPU Ready';
      console.log('✅ WebGPU initialized');
    } catch (error) {
      this.elements.gpuStatus.textContent = '❌ WebGPU Not Available';
      console.error('WebGPU initialization failed:', error);
      alert('WebGPU is required but not available. Please use a compatible browser (Chrome/Edge 113+).');
      return;
    }

    // Initialize visualizer
    this.visualizer = new Visualizer(
      this.elements.previewCanvas,
      this.elements.outputCanvas
    );
    console.log('✅ Visualizer initialized');

    // Initialize pipeline manager
    this.pipeline = new PipelineManager(this.gpu, this.visualizer);
    console.log('✅ Pipeline manager initialized');

    // Initialize node editor
    this.editor = new NodeEditor(
      document.getElementById('rete'),
      this.pipeline,
      this.visualizer
    );
    await this.editor.init();
    console.log('✅ Node editor initialized');

    // Set up event listeners
    this.setupEventListeners();

    // Create default graph
    await this.createDefaultGraph();

    this.updateStatus('Ready', 'ready');
    console.log('🎉 Application ready!');
  }

  setupEventListeners() {
    // Generate button
    this.elements.btnGenerate.addEventListener('click', async () => {
      await this.generate();
    });

    // Save button
    this.elements.btnSave.addEventListener('click', async () => {
      await this.save();
    });

    // Load button
    this.elements.btnLoad.addEventListener('click', async () => {
      await this.load();
    });

    // Export button
    this.elements.btnExport.addEventListener('click', async () => {
      await this.export();
    });

    // Output tabs
    this.elements.outputTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.elements.outputTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.currentOutputMap = tab.dataset.map;
        this.updateOutputDisplay();
      });
    });

    // Colormap selector
    document.getElementById('colormap-select').addEventListener('change', (e) => {
      this.visualizer.setColormap(e.target.value);
      this.editor.refreshPreview();
    });

    // Resolution selector
    document.getElementById('resolution-select').addEventListener('change', (e) => {
      const resolution = parseInt(e.target.value);
      this.pipeline.setResolution(resolution);
      this.updateStatus(`Resolution set to ${resolution}x${resolution}`, 'ready');
    });

    // Fullsize toggle
    const btnFullsize = document.getElementById('btn-fullsize');
    const mainLayout = document.querySelector('.main-layout');
    let isFullsize = false;
    
    btnFullsize.addEventListener('click', () => {
      isFullsize = !isFullsize;
      if (isFullsize) {
        mainLayout.classList.add('fullsize');
        btnFullsize.textContent = '⛶ Exit Full Size';
      } else {
        mainLayout.classList.remove('fullsize');
        btnFullsize.textContent = '⛶ Full Size';
      }
      
      // Trigger resize event for canvas
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 550);
    });

    // Auto-generate toggle
    this.elements.autoGenerate.addEventListener('change', (e) => {
      if (e.target.checked) {
        this.startAutoGenerate();
      } else {
        this.stopAutoGenerate();
      }
    });
  }

  startAutoGenerate() {
    console.log('Auto-generate enabled');
    this.updateStatus('Auto-generate enabled', 'ready');
    
    // Check every 1.5 seconds
    this.autoGenerateInterval = setInterval(async () => {
      const graph = this.editor.getGraph();
      const currentHash = JSON.stringify(graph);
      
      // Only regenerate if graph changed
      if (currentHash !== this.lastGraphHash) {
        this.lastGraphHash = currentHash;
        await this.generate();
      }
    }, 1500);
  }

  stopAutoGenerate() {
    console.log('Auto-generate disabled');
    if (this.autoGenerateInterval) {
      clearInterval(this.autoGenerateInterval);
      this.autoGenerateInterval = null;
    }
    this.updateStatus('Auto-generate disabled', 'ready');
  }

  async createDefaultGraph() {
    console.log('Creating default graph...');
    
    // Create a simple noise -> output graph
    const seedNode = await this.editor.createNode('SeedInput', 100, 100);
    const noiseNode = await this.editor.createNode('PerlinNoise', 100, 250);
    const normalizeNode = await this.editor.createNode('Normalize', 100, 450);
    const depthNode = await this.editor.createNode('DepthOutput', 100, 600);
    
    // Connect them
    if (seedNode && noiseNode && normalizeNode && depthNode) {
      await this.editor.connect(seedNode, 'seed', noiseNode, 'seed');
      await this.editor.connect(noiseNode, 'output', normalizeNode, 'input');
      await this.editor.connect(normalizeNode, 'output', depthNode, 'input');
    }
  }

  async generate() {
    this.updateStatus('Generating...', 'generating');
    this.elements.btnGenerate.disabled = true;

    try {
      const startTime = performance.now();
      
      // Execute the node graph
      await this.pipeline.execute(this.editor.getGraph());
      
      const endTime = performance.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);

      // Update output info
      this.elements.outputTime.textContent = `${duration}s`;
      this.elements.outputResolution.textContent = `${this.pipeline.resolution}x${this.pipeline.resolution}`;
      this.elements.outputSeed.textContent = this.pipeline.seed || 'N/A';

      // Auto-switch to first available output tab (prioritize newest)
      const availableOutputs = ['blockmap', 'biome', 'water', 'depth', 'features', 'trails'];
      for (const output of availableOutputs) {
        if (this.pipeline.getOutput(output)) {
          this.currentOutputMap = output;
          // Update active tab
          this.elements.outputTabs.forEach(t => {
            t.classList.remove('active');
            if (t.dataset.map === output) {
              t.classList.add('active');
            }
          });
          break;
        }
      }

      // Display results
      this.updateOutputDisplay();

      this.updateStatus('Generation complete', 'ready');
      console.log(`✅ Generation completed in ${duration}s`);
    } catch (error) {
      this.updateStatus('Generation failed', 'error');
      console.error('Generation error:', error);
      alert(`Generation failed: ${error.message}`);
    } finally {
      this.elements.btnGenerate.disabled = false;
    }
  }

  updateOutputDisplay() {
    const mapData = this.pipeline.getOutput(this.currentOutputMap);
    if (mapData && mapData.data) {
      // Use renderOutput which handles different map types correctly
      this.visualizer.renderOutput(mapData, this.currentOutputMap);
    }
  }

  async save() {
    try {
      const graph = this.editor.getGraph();
      const timestamp = new Date().toLocaleString();
      
      const response = await fetch('/api/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          graph: {
            ...graph,
            seed: this.pipeline.seed,
            resolution: this.pipeline.resolution,
            savedAt: timestamp,
            nodeCount: graph.nodes.length,
            connectionCount: graph.connections.length
          }
        })
      });

      const result = await response.json();
      if (result.success) {
        this.updateStatus(`Graph saved: ${result.id}`, 'success');
        alert(`✅ Graph Saved Successfully!\n\nID: ${result.id}\nNodes: ${graph.nodes.length}\nConnections: ${graph.connections.length}\nTime: ${timestamp}`);
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Save error:', error);
      this.updateStatus('Save failed', 'error');
      alert(`❌ Failed to save: ${error.message}`);
    }
  }

  async load() {
    try {
      const response = await fetch('/api/list');
      const graphs = await response.json();
      
      if (graphs.length === 0) {
        alert('📂 No saved graphs found.\n\nSave a graph first using the 💾 Save button.');
        return;
      }

      // Create readable list with metadata
      const graphList = graphs.map((g, i) => {
        const meta = g.graph || {};
        const nodeCount = meta.nodeCount || meta.nodes?.length || '?';
        const savedAt = meta.savedAt || 'Unknown time';
        return `${i}: ${g.id}\n   Nodes: ${nodeCount} | Saved: ${savedAt}`;
      }).join('\n\n');
      
      const id = prompt(`📂 Available Saved Graphs:\n\n${graphList}\n\n👉 Enter number to load (or cancel):`);
      
      if (id !== null && id.trim() !== '') {
        const index = parseInt(id);
        const graph = graphs[index];
        
        if (graph) {
          const loadResponse = await fetch(`/api/load/${graph.id}`);
          const data = await loadResponse.json();
          
          // Restore graph structure
          await this.editor.deserialize(data.graph);
          
          // Restore pipeline settings if saved
          if (data.graph.seed) {
            this.pipeline.seed = data.graph.seed;
          }
          if (data.graph.resolution) {
            this.pipeline.setResolution(data.graph.resolution);
          }
          
          const nodeCount = data.graph.nodes?.length || 0;
          const connCount = data.graph.connections?.length || 0;
          
          this.updateStatus(`Loaded: ${graph.id}`, 'success');
          alert(`✅ Graph Loaded Successfully!\n\nID: ${graph.id}\nNodes: ${nodeCount}\nConnections: ${connCount}\nSeed: ${data.graph.seed || 'default'}\nResolution: ${data.graph.resolution || '512'}x${data.graph.resolution || '512'}`);
        } else {
          alert(`❌ Invalid selection. Please enter a number from 0 to ${graphs.length - 1}`);
        }
      }
    } catch (error) {
      console.error('Load error:', error);
      this.updateStatus('Load failed', 'error');
      alert(`❌ Failed to load: ${error.message}`);
    }
  }

  async export() {
    try {
      const seed = this.pipeline.seed;
      const resolution = this.pipeline.resolution;
      const worldId = `world_${seed}`;
      
      this.updateStatus('Exporting world...', 'info');
      
      // Raw data maps (for ray marcher) - get from node results
      const rawDataMaps = {};
      
      console.log('Scanning for raw data nodes...');
      console.log('Total nodes:', this.pipeline.nodeResults.size);
      
      // Find nodes by checking their output types
      this.pipeline.nodeResults.forEach((result, nodeId) => {
        const node = this.editor.nodes.get(nodeId);
        if (!node) {
          console.log(`⚠️ Node ${nodeId} not found in editor`);
          return;
        }
        
        console.log(`Checking node ${nodeId} (${node.type}):`, Object.keys(result));
        
        // BlockClassifier outputs terrainBlocks and waterBlocks (block TYPE IDs)
        if (result.terrainBlocks) {
          rawDataMaps.terrainBlocks = result.terrainBlocks;
          console.log('✅ Found terrain blocks');
        }
        
        if (result.waterBlocks) {
          rawDataMaps.waterBlockTypes = result.waterBlocks;
          console.log('✅ Found water block types');
        }
        
        // HeightLOD node outputs LOD levels
        if (result.lod0 && result.lod1 && result.lod2 && result.lod3) {
          rawDataMaps.heightLOD = {
            lod0: result.lod0,
            lod1: result.lod1,
            lod2: result.lod2,
            lod3: result.lod3
          };
        }
        
        // Water or WaterOutput node outputs water surface elevation
        if ((node.type === 'Water' || node.type === 'WaterOutput') && result.output) {
          // Check if it's Float32Array (elevation data) not Uint16Array (block IDs)
          if (result.output instanceof Float32Array) {
            rawDataMaps.waterElevation = result.output;
            
            // Find min/max without spreading (avoid stack overflow)
            let min = Infinity, max = -Infinity;
            for (let i = 0; i < result.output.length; i++) {
              if (result.output[i] < min) min = result.output[i];
              if (result.output[i] > max) max = result.output[i];
            }
            
            console.log(`✅ Found water elevation from ${node.type} node:`, {
              length: result.output.length,
              sample: Array.from(result.output.slice(0, 10)),
              min: min,
              max: max
            });
          }
        }
      });
      
      // Export raw data as PNG images + JSON manifest
      const rawDataExists = Object.keys(rawDataMaps).length > 0;
      if (rawDataExists) {
        console.log('Exporting world data as PNG images:', Object.keys(rawDataMaps));
        
        // Get block definitions from BlockClassifier node
        let blockDefinitions = null;
        this.pipeline.nodeResults.forEach((result, nodeId) => {
          const node = this.editor.nodes.get(nodeId);
          if (node && node.type === 'BlockClassifier') {
            blockDefinitions = node.params.blocks;
          }
        });
        
        // Collect animation nodes
        const animations = {};
        this.editor.nodes.forEach((node, nodeId) => {
          if (node.type === 'SurfaceAnimation') {
            animations[nodeId] = {
              name: node.params.name,
              type: node.params.type,
              speed: node.params.speed,
              scale: node.params.scale,
              strength: node.params.strength,
              octaves: node.params.octaves,
              direction: [node.params.direction.x, node.params.direction.y]
            };
          }
        });
        
        const exportData = {
          seed: seed,
          resolution: resolution,
          voxelSize: 0.333,
          blocks: blockDefinitions || [],
          animations: animations
        };
        
        // Prepare files for server upload
        const filesToUpload = {};
        const imageFiles = {};
        
        // Convert heightmaps to PNG base64
        if (rawDataMaps.heightLOD) {
          for (const [lodKey, lodData] of Object.entries(rawDataMaps.heightLOD)) {
            const resolution = lodKey === 'lod0' ? 512 : lodKey === 'lod1' ? 128 : lodKey === 'lod2' ? 32 : 8;
            const pngDataUrl = await this.exportDataToPNG(lodData, resolution, 'height');
            const filename = `height_${lodKey}.png`;
            filesToUpload[filename] = pngDataUrl;
            imageFiles[`height${lodKey.toUpperCase()}`] = filename;
          }
        }
        
        // Convert water elevation to PNG base64
        if (rawDataMaps.waterElevation) {
          const pngDataUrl = await this.exportDataToPNG(rawDataMaps.waterElevation, resolution, 'water');
          const filename = `waterHeight.png`;
          filesToUpload[filename] = pngDataUrl;
          imageFiles.waterHeight = filename;
        }
        
        // Convert terrain block map to PNG base64
        if (rawDataMaps.terrainBlocks) {
          const pngDataUrl = await this.exportDataToPNG(rawDataMaps.terrainBlocks, resolution, 'blocks');
          const filename = `terrainBlocks.png`;
          filesToUpload[filename] = pngDataUrl;
          imageFiles.terrainBlocks = filename;
        }
        
        // Convert water block map to PNG base64 (if available)
        if (rawDataMaps.waterBlockTypes) {
          const pngDataUrl = await this.exportDataToPNG(rawDataMaps.waterBlockTypes, resolution, 'blocks');
          const filename = `waterBlocks.png`;
          filesToUpload[filename] = pngDataUrl;
          imageFiles.waterBlocks = filename;
        }
        
        // Create JSON manifest
        exportData.files = imageFiles;
        filesToUpload['world.json'] = JSON.stringify(exportData, null, 2);
        
        console.log('📤 Uploading world to server:', worldId);
        this.updateStatus('Uploading world to server...', 'info');
        
        // Upload to server
        const response = await fetch(`/api/worlds/${worldId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: filesToUpload })
        });
        
        if (!response.ok) {
          throw new Error('Failed to upload world to server');
        }
        
        const result = await response.json();
        console.log('✅ World saved to server:', result);
        
        this.updateStatus('World exported successfully!', 'success');
        alert(`✅ World exported successfully!\n\nWorld ID: ${worldId}\n\nYou can now enter this world from the world viewer.`);
      } else {
        console.warn('⚠️ No raw data maps found.');
        alert('⚠️ No world data to export. Make sure you have HeightLOD, Water, and BlockClassifier nodes connected.');
      }
    } catch (error) {
      console.error('Export error:', error);
      alert(`Export failed: ${error.message}`);
    }
  }

  async exportDataToPNG(data, resolution, dataType) {
    // Create temporary canvas
    const canvas = document.createElement('canvas');
    canvas.width = resolution;
    canvas.height = resolution;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(resolution, resolution);
    
    // Convert data to 8-bit PNG (R channel only)
    for (let i = 0; i < data.length; i++) {
      let value;
      
      if (dataType === 'height' || dataType === 'water') {
        // Normalize float data (0.0-1.0) to 0-255
        value = Math.floor(data[i] * 255);
      } else if (dataType === 'blocks') {
        // Block IDs are already integers (0-255)
        value = data[i];
      }
      
      value = Math.max(0, Math.min(255, value)); // Clamp
      
      const idx = i * 4;
      imageData.data[idx] = value;     // R
      imageData.data[idx + 1] = value; // G (duplicate for grayscale)
      imageData.data[idx + 2] = value; // B (duplicate for grayscale)
      imageData.data[idx + 3] = 255;   // A
    }
    
    ctx.putImageData(imageData, 0, 0);
    
    // Convert to PNG base64 data URL
    return canvas.toDataURL('image/png');
  }

  downloadFile(dataUrl, filename) {
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    link.click();
    // Clean up blob URLs to prevent memory leaks
    setTimeout(() => URL.revokeObjectURL(dataUrl), 100);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  updateStatus(message, type = 'info') {
    this.elements.generationStatus.textContent = message;
    this.elements.generationStatus.className = `status-${type}`;
  }
}

// Initialize app when DOM is ready
window.addEventListener('DOMContentLoaded', async () => {
  const app = new App();
  await app.init();
  
  // Expose for debugging
  window.app = app;
});
