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
      // Visual maps (PNG)
      const visualMaps = ['depth', 'biome', 'water', 'features', 'trails', 'blockmap'];
      
      for (const mapType of visualMaps) {
        const data = this.pipeline.getOutput(mapType);
        if (data) {
          const png = await this.visualizer.exportToPNG(data, mapType);
          this.downloadPNG(png, `map-${mapType}-${this.pipeline.seed}.png`);
        }
      }
      
      // Raw data maps (for ray marcher) - export as binary JSON
      const rawDataMaps = {
        terrainBlocks: this.pipeline.getOutput('terrainBlocks'),
        waterBlocks: this.pipeline.getOutput('waterBlocks'),
        heightLOD: {
          lod0: this.pipeline.getOutput('lod0'),
          lod1: this.pipeline.getOutput('lod1'),
          lod2: this.pipeline.getOutput('lod2'),
          lod3: this.pipeline.getOutput('lod3')
        }
      };
      
      // Export raw data as JSON (arrays will be converted to base64)
      const rawDataExists = Object.values(rawDataMaps).some(v => v && v.data);
      if (rawDataExists) {
        const exportData = {
          seed: this.pipeline.seed,
          resolution: this.pipeline.resolution,
          maps: {}
        };
        
        // Convert typed arrays to arrays for JSON
        for (const [key, output] of Object.entries(rawDataMaps)) {
          if (output && output.data) {
            if (key === 'heightLOD') {
              exportData.maps.heightLOD = {};
              for (const [lodKey, lodOutput] of Object.entries(output)) {
                if (lodOutput && lodOutput.data) {
                  exportData.maps.heightLOD[lodKey] = {
                    resolution: lodOutput.resolution || 512,
                    data: Array.from(lodOutput.data)
                  };
                }
              }
            } else {
              exportData.maps[key] = {
                resolution: output.resolution,
                data: Array.from(output.data)
              };
            }
          }
        }
        
        const json = JSON.stringify(exportData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        this.downloadPNG(url, `world-data-${this.pipeline.seed}.json`);
      }
      
      alert('Maps exported successfully!');
    } catch (error) {
      console.error('Export error:', error);
      alert(`Export failed: ${error.message}`);
    }
  }

  downloadPNG(dataUrl, filename) {
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    link.click();
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
