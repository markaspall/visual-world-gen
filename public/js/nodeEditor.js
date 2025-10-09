/**
 * Custom Node Editor
 * Lightweight node-based editor for procedural generation pipeline
 */
export class NodeEditor {
  constructor(container, pipeline, visualizer) {
    this.container = container;
    this.pipeline = pipeline;
    this.visualizer = visualizer;
    
    this.nodes = new Map();
    this.connections = [];
    this.selectedNode = null;
    this.dragOffset = { x: 0, y: 0 };
    this.connectionStart = null;
    
    this.scale = 0.5; // Default 50% zoom for more spacing
    this.offset = { x: 0, y: 0 };
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };
    
    this.canvas = null;
    this.ctx = null;
    this.nodeIdCounter = 0;
  }

  async init() {
    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.container.clientWidth;
    this.canvas.height = this.container.clientHeight;
    this.container.appendChild(this.canvas);
    
    this.ctx = this.canvas.getContext('2d');
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Initial render
    this.render();
    
    console.log('Node editor initialized');
  }

  setupEventListeners() {
    // Mouse events
    this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
    this.canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
    
    // Click outside to close parameter panel
    document.addEventListener('mousedown', (e) => {
      const panel = document.getElementById('parameter-panel');
      if (!panel || !panel.classList.contains('active')) return;
      
      // Check if click is outside both canvas and panel
      const clickedPanel = panel.contains(e.target);
      const clickedCanvas = this.canvas.contains(e.target);
      
      if (!clickedPanel && !clickedCanvas) {
        // Cleanup animations before closing
        if (this.animationCleanups) {
          this.animationCleanups.forEach(cleanup => cleanup());
          this.animationCleanups = [];
        }
        
        this.selectedNode = null;
        panel.classList.remove('active');
        this.render();
      }
    });
    this.canvas.addEventListener('contextmenu', this.onContextMenu.bind(this));
    this.canvas.addEventListener('dblclick', this.onDoubleClick.bind(this));
    
    // Keyboard for pan mode
    this.spacePressed = false;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !this.spacePressed) {
        this.spacePressed = true;
        this.canvas.style.cursor = 'grab';
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spacePressed = false;
        this.canvas.style.cursor = 'default';
        this.isPanning = false;
      }
    });
    
    // Delete key for removing selected node
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' && this.selectedNode) {
        this.deleteNode(this.selectedNode.id);
      }
    });
    
    // Resize observer
    new ResizeObserver(() => {
      this.canvas.width = this.container.clientWidth;
      this.canvas.height = this.container.clientHeight;
      this.render();
    }).observe(this.container);
    
    // Add node button
    document.getElementById('btn-add-node')?.addEventListener('click', () => {
      this.showAddNodeModal();
    });
    
    // Clear button
    document.getElementById('btn-clear')?.addEventListener('click', () => {
      if (confirm('Clear all nodes?')) {
        this.clear();
      }
    });
    
    // Auto Layout button
    document.getElementById('btn-auto-layout')?.addEventListener('click', () => {
      this.autoLayout();
    });
  }

  showAddNodeModal() {
    const modal = document.getElementById('modal-add-node');
    modal.classList.add('active');
    
    const closeBtn = modal.querySelector('.modal-close');
    const backdrop = modal;
    
    const close = () => modal.classList.remove('active');
    
    closeBtn.onclick = close;
    backdrop.onclick = (e) => {
      if (e.target === backdrop) close();
    };
    
    // Node type buttons
    modal.querySelectorAll('.node-type-btn').forEach(btn => {
      btn.onclick = async () => {
        const type = btn.dataset.type;
        await this.createNode(type, 100, 100);
        close();
        this.render();
      };
    });
  }

  async createNode(type, x, y) {
    const nodeId = `node-${this.nodeIdCounter++}`;
    const nodeClass = this.pipeline.getNodeClass(type);
    
    if (!nodeClass) {
      console.error(`Unknown node type: ${type}`);
      return null;
    }
    
    // Calculate node height based on number of inputs/outputs
    const numInputs = nodeClass.inputs ? nodeClass.inputs.length : 0;
    const numOutputs = nodeClass.outputs ? nodeClass.outputs.length : 0;
    const maxSockets = Math.max(numInputs, numOutputs);
    const nodeHeight = Math.max(100, 60 + maxSockets * 25);
    
    const node = {
      id: nodeId,
      type: type,
      x: x,
      y: y,
      width: 200,
      height: nodeHeight,
      inputs: nodeClass.inputs || [],
      outputs: nodeClass.outputs || [],
      params: { ...nodeClass.defaultParams },
      instance: new nodeClass(this.pipeline.gpu)
    };
    
    this.nodes.set(nodeId, node);
    this.render();
    
    return node;
  }

  async connect(sourceNode, outputName, targetNode, inputName) {
    // Check if connection already exists
    const exists = this.connections.some(c => 
      c.from === sourceNode.id && 
      c.output === outputName && 
      c.to === targetNode.id && 
      c.input === inputName
    );
    
    if (!exists) {
      this.connections.push({
        from: sourceNode.id,
        output: outputName,
        to: targetNode.id,
        input: inputName
      });
      this.render();
    }
  }

  disconnect(connection) {
    const index = this.connections.indexOf(connection);
    if (index > -1) {
      this.connections.splice(index, 1);
      this.render();
    }
  }

  clear() {
    if (confirm('Clear all nodes and connections?')) {
      this.nodes.clear();
      this.connections = [];
      this.selectedNode = null;
      this.render();
    }
  }

  autoLayout() {
    if (this.nodes.size === 0) return;
    
    // Compute layers using topological sort
    const layers = this.computeGraphLayers();
    
    // Layout parameters
    const LAYER_WIDTH = 350;
    const NODE_HEIGHT = 120;
    const START_X = 100;
    const START_Y = 100;
    
    // Position nodes by layer
    layers.forEach((layerNodes, layerIndex) => {
      const x = START_X + layerIndex * LAYER_WIDTH;
      
      layerNodes.forEach((nodeId, indexInLayer) => {
        const node = this.nodes.get(nodeId);
        if (node) {
          node.x = x;
          node.y = START_Y + indexInLayer * NODE_HEIGHT;
        }
      });
    });
    
    this.render();
    console.log(`Auto-layout applied: ${layers.length} layers, ${this.nodes.size} nodes`);
  }

  computeGraphLayers() {
    // Build dependency map
    const inDegree = new Map();
    const dependencies = new Map();
    
    // Initialize
    this.nodes.forEach((node, id) => {
      inDegree.set(id, 0);
      dependencies.set(id, []);
    });
    
    // Count incoming edges
    this.connections.forEach(conn => {
      const current = inDegree.get(conn.to) || 0;
      inDegree.set(conn.to, current + 1);
      dependencies.get(conn.to).push(conn.from);
    });
    
    // Topological sort with layer assignment
    const layers = [];
    const nodeLayer = new Map();
    const queue = [];
    
    // Start with nodes that have no dependencies (layer 0)
    inDegree.forEach((degree, nodeId) => {
      if (degree === 0) {
        queue.push(nodeId);
        nodeLayer.set(nodeId, 0);
      }
    });
    
    // Process queue
    while (queue.length > 0) {
      const nodeId = queue.shift();
      const layer = nodeLayer.get(nodeId);
      
      // Add to layer
      if (!layers[layer]) layers[layer] = [];
      layers[layer].push(nodeId);
      
      // Process dependent nodes
      this.connections.forEach(conn => {
        if (conn.from === nodeId) {
          const targetId = conn.to;
          inDegree.set(targetId, inDegree.get(targetId) - 1);
          
          // Calculate target layer (max of all inputs + 1)
          const inputLayers = dependencies.get(targetId).map(id => nodeLayer.get(id) || 0);
          const targetLayer = Math.max(...inputLayers) + 1;
          nodeLayer.set(targetId, targetLayer);
          
          if (inDegree.get(targetId) === 0) {
            queue.push(targetId);
          }
        }
      });
    }
    
    return layers;
  }

  deleteConnection(connection) {
    const index = this.connections.findIndex(
      conn => conn.from === connection.from && 
              conn.to === connection.to && 
              conn.output === connection.output && 
              conn.input === connection.input
    );
    
    if (index !== -1) {
      this.connections.splice(index, 1);
      this.render();
    }
  }

  // Mouse event handlers
  onMouseDown(e) {
    const pos = this.getMousePos(e);
    const worldPos = this.screenToWorld(pos);
    
    // Middle mouse, space+left mouse, or shift+left mouse for panning
    if (e.button === 1 || (e.button === 0 && this.spacePressed) || (e.button === 0 && e.shiftKey)) {
      this.isPanning = true;
      this.panStart = { x: e.clientX, y: e.clientY };
      this.canvas.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }
    
    // Check for socket click (connection start)
    for (const [id, node] of this.nodes) {
      const socketInfo = this.hitTestSocket(node, worldPos);
      if (socketInfo) {
        this.connectionStart = { node, ...socketInfo };
        return;
      }
    }
    
    // Check for node click
    const clickedNode = this.getNodeAt(worldPos);
    if (clickedNode) {
      // Check if clicked on header (top 30px) or body
      const headerHeight = 30;
      const clickedOnHeader = (worldPos.y - clickedNode.y) <= headerHeight;
      
      if (clickedOnHeader) {
        // Header click - enable dragging
        this.draggedNode = clickedNode;
        this.dragOffset = {
          x: worldPos.x - clickedNode.x,
          y: worldPos.y - clickedNode.y
        };
        // Don't change selection, just enable drag
        this.render();
      } else {
        // Body click - show parameters (no drag)
        this.selectedNode = clickedNode;
        this.draggedNode = null; // Don't drag on body click
        
        // Show preview for selected node
        this.refreshPreview();
        
        this.render();
      }
    } else {
      this.selectedNode = null;
      // Hide parameter panel when clicking away
      const panel = document.getElementById('parameter-panel');
      if (panel) panel.classList.remove('active');
      this.render();
    }
  }

  onMouseMove(e) {
    const pos = this.getMousePos(e);
    const worldPos = this.screenToWorld(pos);
    
    if (this.isPanning) {
      const dx = e.clientX - this.panStart.x;
      const dy = e.clientY - this.panStart.y;
      this.offset.x += dx;
      this.offset.y += dy;
      this.panStart = { x: e.clientX, y: e.clientY };
      this.render();
      return;
    }
    
    if (this.draggedNode) {
      this.draggedNode.x = worldPos.x - this.dragOffset.x;
      this.draggedNode.y = worldPos.y - this.dragOffset.y;
      this.render();
    } else if (this.connectionStart) {
      this.render();
      // Draw temporary connection line
      const startSocket = this.getSocketPos(
        this.connectionStart.node,
        this.connectionStart.name,
        this.connectionStart.type
      );
      const startScreen = this.worldToScreen(startSocket);
      this.drawConnection(this.ctx, startScreen.x, startScreen.y, pos.x, pos.y, '#4a9eff');
    }
  }

  onMouseUp(e) {
    if (this.isPanning) {
      this.isPanning = false;
      this.canvas.style.cursor = this.spacePressed ? 'grab' : 'default';
    }
    
    if (this.connectionStart) {
      const pos = this.getMousePos(e);
      const worldPos = this.screenToWorld(pos);
      
      // Check if we ended on a socket
      for (const [id, node] of this.nodes) {
        const socketInfo = this.hitTestSocket(node, worldPos);
        if (socketInfo && socketInfo.type !== this.connectionStart.type) {
          // Create connection
          if (this.connectionStart.type === 'output') {
            this.connect(
              this.connectionStart.node,
              this.connectionStart.name,
              node,
              socketInfo.name
            );
          } else {
            this.connect(
              node,
              socketInfo.name,
              this.connectionStart.node,
              this.connectionStart.name
            );
          }
          break;
        }
      }
      
      this.connectionStart = null;
    }
    
    this.draggedNode = null;
    this.render();
  }

  onWheel(e) {
    e.preventDefault();
    
    // Zoom with mouse wheel
    const pos = this.getMousePos(e);
    const worldPosBefore = this.screenToWorld(pos);
    
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.1, Math.min(3, this.scale * zoomFactor));
    
    this.scale = newScale;
    
    // Adjust offset to zoom toward mouse position
    const worldPosAfter = this.screenToWorld(pos);
    this.offset.x += (worldPosAfter.x - worldPosBefore.x) * this.scale;
    this.offset.y += (worldPosAfter.y - worldPosBefore.y) * this.scale;
    
    this.render();
  }

  onContextMenu(e) {
    e.preventDefault();
    
    const pos = this.getMousePos(e);
    const worldPos = this.screenToWorld(pos);
    
    // Check if right-clicked on a connection
    const connection = this.getConnectionAt(worldPos);
    if (connection) {
      if (confirm('Delete this connection?')) {
        this.deleteConnection(connection);
      }
      return;
    }
    
    // Check if right-clicked on a node
    const node = this.getNodeAt(worldPos);
    if (node) {
      if (confirm(`Delete node "${node.displayName || node.type}"?`)) {
        this.deleteNode(node.id);
      }
    }
  }

  onDoubleClick(e) {
    const pos = this.getMousePos(e);
    const worldPos = this.screenToWorld(pos);
    
    const node = this.getNodeAt(worldPos);
    if (node) {
      // Check if double-click is on the header (title area)
      const headerHeight = 30;
      if (worldPos.y >= node.y && worldPos.y <= node.y + headerHeight) {
        const newName = prompt(`Rename node:`, node.displayName || node.type);
        if (newName !== null && newName.trim() !== '') {
          node.displayName = newName.trim();
          this.render();
        }
      }
    }
  }

  // Utility methods
  getMousePos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  screenToWorld(screenPos) {
    return {
      x: (screenPos.x - this.offset.x) / this.scale,
      y: (screenPos.y - this.offset.y) / this.scale
    };
  }

  worldToScreen(worldPos) {
    return {
      x: worldPos.x * this.scale + this.offset.x,
      y: worldPos.y * this.scale + this.offset.y
    };
  }

  getNodeAt(pos) {
    for (const [id, node] of this.nodes) {
      if (pos.x >= node.x && pos.x <= node.x + node.width &&
          pos.y >= node.y && pos.y <= node.y + node.height) {
        return node;
      }
    }
    return null;
  }

  getConnectionAt(pos) {
    const threshold = 15 / this.scale; // Click threshold in world space (increased for easier clicking)
    
    for (const conn of this.connections) {
      const fromNode = this.nodes.get(conn.from);
      const toNode = this.nodes.get(conn.to);
      
      if (!fromNode || !toNode) continue;
      
      const fromPos = this.getSocketPos(fromNode, conn.output, 'output');
      const toPos = this.getSocketPos(toNode, conn.input, 'input');
      
      // Check if click is near the bezier curve (simplified: check multiple points along curve)
      const samples = 20;
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const curvePos = this.getBezierPoint(fromPos, toPos, t);
        
        const dx = pos.x - curvePos.x;
        const dy = pos.y - curvePos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < threshold) {
          return conn;
        }
      }
    }
    
    return null;
  }

  getBezierPoint(start, end, t) {
    const cx = (start.x + end.x) / 2;
    const p0 = { x: start.x, y: start.y };
    const p1 = { x: cx, y: start.y };
    const p2 = { x: cx, y: end.y };
    const p3 = { x: end.x, y: end.y };
    
    const t1 = 1 - t;
    const t1_2 = t1 * t1;
    const t1_3 = t1_2 * t1;
    const t_2 = t * t;
    const t_3 = t_2 * t;
    
    return {
      x: t1_3 * p0.x + 3 * t1_2 * t * p1.x + 3 * t1 * t_2 * p2.x + t_3 * p3.x,
      y: t1_3 * p0.y + 3 * t1_2 * t * p1.y + 3 * t1 * t_2 * p2.y + t_3 * p3.y
    };
  }

  hitTestSocket(node, pos) {
    const socketRadius = 8;
    
    // Check outputs
    for (let i = 0; i < node.outputs.length; i++) {
      const socketPos = this.getSocketPos(node, node.outputs[i], 'output', i);
      const dist = Math.sqrt(
        Math.pow(pos.x - socketPos.x, 2) + 
        Math.pow(pos.y - socketPos.y, 2)
      );
      if (dist <= socketRadius) {
        return { type: 'output', name: node.outputs[i], index: i };
      }
    }
    
    // Check inputs
    for (let i = 0; i < node.inputs.length; i++) {
      const socketPos = this.getSocketPos(node, node.inputs[i], 'input', i);
      const dist = Math.sqrt(
        Math.pow(pos.x - socketPos.x, 2) + 
        Math.pow(pos.y - socketPos.y, 2)
      );
      if (dist <= socketRadius) {
        return { type: 'input', name: node.inputs[i], index: i };
      }
    }
    
    return null;
  }

  getSocketPos(node, name, type, index = 0) {
    const socketRadius = 8;
    const spacing = 30;
    
    if (type === 'output') {
      return {
        x: node.x + node.width,
        y: node.y + 40 + index * spacing
      };
    } else {
      return {
        x: node.x,
        y: node.y + 40 + index * spacing
      };
    }
  }

  // Rendering
  render() {
    const ctx = this.ctx;
    
    // Clear
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Save context and apply transformations
    ctx.save();
    ctx.translate(this.offset.x, this.offset.y);
    ctx.scale(this.scale, this.scale);
    
    // Draw grid
    this.drawGrid(ctx);
    
    // Draw connections
    for (const conn of this.connections) {
      const fromNode = this.nodes.get(conn.from);
      const toNode = this.nodes.get(conn.to);
      
      if (fromNode && toNode) {
        const fromPos = this.getSocketPos(
          fromNode,
          conn.output,
          'output',
          fromNode.outputs.indexOf(conn.output)
        );
        const toPos = this.getSocketPos(
          toNode,
          conn.input,
          'input',
          toNode.inputs.indexOf(conn.input)
        );
        
        this.drawConnection(ctx, fromPos.x, fromPos.y, toPos.x, toPos.y);
      }
    }
    
    // Draw nodes
    for (const [id, node] of this.nodes) {
      this.drawNode(ctx, node, node === this.selectedNode);
    }
    
    // Restore context
    ctx.restore();
    
    // Update zoom info in status bar
    const zoomInfo = document.getElementById('zoom-info');
    if (zoomInfo) {
      zoomInfo.textContent = `Zoom: ${(this.scale * 100).toFixed(0)}% • Pan: Space+Drag or Middle-Click • Scroll: Zoom`;
    }
  }

  drawGrid(ctx) {
    const gridSize = 20;
    ctx.strokeStyle = '#2d2d2d';
    ctx.lineWidth = 1 / this.scale;
    
    // Calculate visible world bounds
    const topLeft = this.screenToWorld({ x: 0, y: 0 });
    const bottomRight = this.screenToWorld({ x: this.canvas.width, y: this.canvas.height });
    
    const startX = Math.floor(topLeft.x / gridSize) * gridSize;
    const endX = Math.ceil(bottomRight.x / gridSize) * gridSize;
    const startY = Math.floor(topLeft.y / gridSize) * gridSize;
    const endY = Math.ceil(bottomRight.y / gridSize) * gridSize;
    
    for (let x = startX; x <= endX; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
      ctx.stroke();
    }
    
    for (let y = startY; y <= endY; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();
    }
  }

  drawNode(ctx, node, selected = false) {
    // Node background
    ctx.fillStyle = '#2d2d2d';
    ctx.strokeStyle = selected ? '#4a9eff' : '#3a3a3a';
    ctx.lineWidth = selected ? 3 : 2;
    
    this.roundRect(ctx, node.x, node.y, node.width, node.height, 8);
    ctx.fill();
    ctx.stroke();
    
    // Title bar
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    this.roundRect(ctx, node.x, node.y, node.width, 30, 8, true);
    ctx.fill();
    
    // Title text
    ctx.fillStyle = '#e0e0e0';
    ctx.font = '14px sans-serif';
    ctx.fillText(node.displayName || node.type, node.x + 10, node.y + 20);
    
    // Draw sockets
    ctx.fillStyle = '#4a9eff';
    ctx.strokeStyle = '#4a9eff';
    ctx.lineWidth = 2;
    
    // Input sockets
    for (let i = 0; i < node.inputs.length; i++) {
      const pos = this.getSocketPos(node, node.inputs[i], 'input', i);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      
      // Label
      ctx.fillStyle = '#a0a0a0';
      ctx.font = '12px sans-serif';
      ctx.fillText(node.inputs[i], pos.x + 12, pos.y + 4);
      ctx.fillStyle = '#4a9eff';
    }
    
    // Output sockets
    for (let i = 0; i < node.outputs.length; i++) {
      const pos = this.getSocketPos(node, node.outputs[i], 'output', i);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      
      // Label
      ctx.fillStyle = '#a0a0a0';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(node.outputs[i], pos.x - 12, pos.y + 4);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#4a9eff';
    }
  }

  drawConnection(ctx, x1, y1, x2, y2, color = '#4a9eff') {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    
    const dx = Math.abs(x2 - x1);
    const offset = Math.min(dx * 0.5, 100);
    
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(
      x1 + offset, y1,
      x2 - offset, y2,
      x2, y2
    );
    ctx.stroke();
  }

  roundRect(ctx, x, y, width, height, radius, topOnly = false) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.arcTo(x + width, y, x + width, y + radius, radius);
    
    if (topOnly) {
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x, y + height);
    } else {
      ctx.lineTo(x + width, y + height - radius);
      ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
      ctx.lineTo(x + radius, y + height);
      ctx.arcTo(x, y + height, x, y + height - radius, radius);
    }
    
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
  }

  // Preview management
  async refreshPreview() {
    if (!this.selectedNode) return;
    
    const previewInfo = document.getElementById('preview-info');
    previewInfo.textContent = `Previewing: ${this.selectedNode.type}`;
    
    // Update parameter UI
    this.updateParameterUI();
    
    try {
      // Special handling for SurfaceAnimation - show animated preview
      if (this.selectedNode.type === 'SurfaceAnimation') {
        previewInfo.textContent = `Live Animation Preview`;
        this.renderAnimationInPreviewPanel(this.selectedNode.params);
        return;
      }
      
      // Get the node's output data
      const result = await this.pipeline.executeNode(this.selectedNode, this.getGraph());
      
      if (result === null) {
        // Preview skipped for nodes that don't produce visualizable data
        previewInfo.textContent = `Preview skipped (run Generate to see output)`;
      } else if (result && result.data) {
        const stats = this.visualizer.calculateStats(result.data);
        this.visualizer.renderPreview(result.data, result.resolution, stats);
      }
    } catch (error) {
      console.error('Preview error:', error);
      previewInfo.textContent = `Error: ${error.message}`;
    }
  }

  updateParameterUI() {
    const container = document.getElementById('param-panel-content');
    const nodeName = document.getElementById('param-node-name');
    const panel = document.getElementById('parameter-panel');
    
    if (!container) return;
    
    // Cleanup any running animations
    if (this.animationCleanups) {
      this.animationCleanups.forEach(cleanup => cleanup());
      this.animationCleanups = [];
    }
    
    if (!this.selectedNode) {
      container.innerHTML = '<div class="param-hint">Select a node to edit its parameters</div>';
      panel.classList.remove('active');
      return;
    }
    
    // Show panel when node is selected
    panel.classList.add('active');
    nodeName.textContent = this.selectedNode.type;
    container.innerHTML = '';
    
    // Merge in any new default params (for nodes created before new params were added)
    const nodeClass = this.pipeline.getNodeClass(this.selectedNode.type);
    if (nodeClass && nodeClass.defaultParams) {
      for (const [key, value] of Object.entries(nodeClass.defaultParams)) {
        if (!(key in this.selectedNode.params)) {
          this.selectedNode.params[key] = value;
          console.log(`Added missing param '${key}' to ${this.selectedNode.type} node`);
        }
      }
    }
    
    const params = this.selectedNode.params;
    
    // Special handling for BiomeClassifier biomes table
    if (this.selectedNode.type === 'BiomeClassifier' && params.biomes) {
      this.renderBiomeTable(container, params.biomes);
      return;
    }
    
    // Special handling for Features table
    if (this.selectedNode.type === 'Features' && params.features) {
      this.renderFeaturesTable(container, params.features);
      return;
    }
    
    // Special handling for BlockClassifier tables
    if (this.selectedNode.type === 'BlockClassifier') {
      this.renderBlockClassifierTables(container, params);
      return;
    }
    
    // Special handling for SurfaceAnimation
    if (this.selectedNode.type === 'SurfaceAnimation') {
      this.renderSurfaceAnimationUI(container, params);
      return;
    }
    
    // Render regular parameters
    for (const [key, value] of Object.entries(params)) {
      const paramItem = document.createElement('div');
      paramItem.className = 'param-item';
      
      const label = document.createElement('label');
      label.textContent = key;
      
      if (typeof value === 'number') {
        const display = document.createElement('div');
        display.className = 'param-display';
        
        // Determine appropriate range for slider
        let min, max, step;
        if (key.toLowerCase().includes('octave')) {
          min = 1; max = 12; step = 1;
        } else if (key.toLowerCase().includes('persistence') || key.toLowerCase().includes('weight')) {
          min = 0; max = 1; step = 0.01;
        } else if (key.toLowerCase().includes('frequency')) {
          min = 0.1; max = 20; step = 0.1;
        } else if (key.toLowerCase().includes('scale')) {
          min = 0.1; max = 100; step = 0.5;
        } else if (key.toLowerCase().includes('lacunarity')) {
          min = 1; max = 4; step = 0.1;
        } else if (key.toLowerCase().includes('step')) {
          min = 2; max = 20; step = 1;
        } else if (key.toLowerCase().includes('iteration')) {
          min = 1; max = 200; step = 1;
        } else if (key.toLowerCase().includes('rate') || key.toLowerCase().includes('smooth')) {
          min = 0; max = 1; step = 0.01;
        } else if (Number.isInteger(value)) {
          min = 0; max = Math.max(100, value * 2); step = 1;
        } else {
          min = 0; max = Math.max(2, value * 2); step = 0.01;
        }
        
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = min;
        slider.max = max;
        slider.step = step;
        slider.value = value;
        slider.title = 'Hold Shift for 10x finer control';
        
        // Editable number input for fine-tuning
        const numberInput = document.createElement('input');
        numberInput.type = 'number';
        numberInput.className = 'param-number-input';
        numberInput.min = min;
        numberInput.max = max;
        numberInput.step = step;
        numberInput.value = typeof value === 'number' && !Number.isInteger(value) 
          ? value.toFixed(2) 
          : value.toString();
        numberInput.style.width = '60px';
        numberInput.style.marginLeft = '8px';
        numberInput.title = 'Scroll to adjust, or type exact value';
        
        // Fine control with shift key
        let baseStep = step;
        slider.addEventListener('mousedown', () => {
          const updateStep = (e) => {
            slider.step = e.shiftKey ? baseStep / 10 : baseStep;
          };
          updateStep({ shiftKey: false });
          
          const keyHandler = (e) => updateStep(e);
          document.addEventListener('keydown', keyHandler);
          document.addEventListener('keyup', keyHandler);
          
          const cleanup = () => {
            document.removeEventListener('keydown', keyHandler);
            document.removeEventListener('keyup', keyHandler);
            slider.step = baseStep;
          };
          
          slider.addEventListener('mouseup', cleanup, { once: true });
          document.addEventListener('mouseup', cleanup, { once: true });
        });
        
        // Update both when slider changes
        slider.addEventListener('input', (e) => {
          const newValue = parseFloat(e.target.value);
          this.selectedNode.params[key] = newValue;
          numberInput.value = !Number.isInteger(newValue) 
            ? newValue.toFixed(2) 
            : newValue.toString();
        });
        
        slider.addEventListener('change', () => {
          this.refreshPreview();
        });
        
        // Update both when number input changes
        numberInput.addEventListener('input', (e) => {
          const newValue = parseFloat(e.target.value);
          if (!isNaN(newValue)) {
            this.selectedNode.params[key] = newValue;
            slider.value = newValue;
          }
        });
        
        numberInput.addEventListener('change', () => {
          this.refreshPreview();
        });
        
        // Scroll to adjust (fine control)
        numberInput.addEventListener('wheel', (e) => {
          e.preventDefault();
          const currentValue = parseFloat(numberInput.value) || 0;
          const scrollStep = e.shiftKey ? step / 10 : step;
          const delta = e.deltaY > 0 ? -scrollStep : scrollStep;
          const newValue = Math.max(min, Math.min(max, currentValue + delta));
          
          numberInput.value = !Number.isInteger(newValue) 
            ? newValue.toFixed(2) 
            : newValue.toString();
          slider.value = newValue;
          this.selectedNode.params[key] = newValue;
          this.refreshPreview();
        });
        
        display.appendChild(slider);
        display.appendChild(numberInput);
        paramItem.appendChild(label);
        paramItem.appendChild(display);
      } else if (typeof value === 'string') {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = value;
        
        input.addEventListener('change', (e) => {
          this.selectedNode.params[key] = e.target.value;
          this.refreshPreview();
        });
        
        paramItem.appendChild(label);
        paramItem.appendChild(input);
      } else if (typeof value === 'boolean') {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = value;
        
        checkbox.addEventListener('change', (e) => {
          this.selectedNode.params[key] = e.target.checked;
          this.refreshPreview();
        });
        
        paramItem.appendChild(label);
        paramItem.appendChild(checkbox);
      } else if (Array.isArray(value)) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = value.join(', ');
        
        input.addEventListener('change', (e) => {
          this.selectedNode.params[key] = e.target.value.split(',').map(v => parseFloat(v.trim()));
          this.refreshPreview();
        });
        
        paramItem.appendChild(label);
        paramItem.appendChild(input);
      }
      
      container.appendChild(paramItem);
    }
  }

  // Graph serialization
  getGraph() {
    return {
      nodes: Array.from(this.nodes.values()).map(n => ({
        id: n.id,
        type: n.type,
        x: n.x,
        y: n.y,
        params: n.params,
        displayName: n.displayName
      })),
      connections: this.connections
    };
  }

  serialize() {
    return JSON.stringify(this.getGraph());
  }

  async deserialize(graphData) {
    this.clear();
    
    const graph = typeof graphData === 'string' ? JSON.parse(graphData) : graphData;
    
    // Create ID mapping from old to new
    const idMap = new Map();
    
    // Recreate nodes with original IDs
    for (const nodeData of graph.nodes) {
      const node = await this.createNode(nodeData.type, nodeData.x, nodeData.y);
      if (node) {
        // Map old ID to new ID
        idMap.set(nodeData.id, node.id);
        
        // Remove the new node
        this.nodes.delete(node.id);
        
        // Re-add with original ID
        node.id = nodeData.id;
        this.nodes.set(nodeData.id, node);
        
        // Restore parameters and display name
        node.params = { ...nodeData.params };
        if (nodeData.displayName) {
          node.displayName = nodeData.displayName;
        }
      }
    }
    
    // Recreate connections (they already have correct IDs now)
    this.connections = graph.connections ? [...graph.connections] : [];
    
    console.log('Graph loaded:', {
      nodes: this.nodes.size,
      connections: this.connections.length
    });
    
    this.render();
  }

  renderBiomeTable(container, biomes) {
    const table = document.createElement('div');
    table.className = 'biome-table param-table';
    table.style.cssText = 'max-height: 320px; overflow-y: auto; overflow-x: hidden; font-size: 0.8rem; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-secondary);';

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display: grid; grid-template-columns: 1.5fr 60px 1fr 1fr 1fr 1fr 50px; gap: 8px; font-weight: 600; padding: 10px 12px; background: var(--bg-tertiary); position: sticky; top: 0; z-index: 1; border-bottom: 2px solid var(--border-color); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary);';
    header.innerHTML = '<div>Name</div><div>Color</div><div>Height</div><div>Moisture</div><div>Temperature</div><div>Water</div><div></div>';
    table.appendChild(header);

    // Rows
    biomes.forEach((biome, index) => {
      const row = document.createElement('div');
      row.style.cssText = 'display: grid; grid-template-columns: 1.5fr 60px 1fr 1fr 1fr 1fr 50px; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border-color); align-items: center; transition: background 0.2s;';
      row.addEventListener('mouseenter', () => row.style.background = 'var(--bg-tertiary)');
      row.addEventListener('mouseleave', () => row.style.background = 'transparent');
      
      // Name
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = biome.name;
      nameInput.style.cssText = 'width: 100%; padding: 6px 8px; font-size: 0.8rem; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary);';
      nameInput.addEventListener('change', (e) => {
        biome.name = e.target.value;
        this.refreshPreview();
      });
      
      // Color
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = biome.color;
      colorInput.style.cssText = 'width: 50px; height: 32px; border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer;';
      colorInput.addEventListener('change', (e) => {
        biome.color = e.target.value;
        this.refreshPreview();
      });
      
      // Helper to create range input
      const createRangeInput = (range, key) => {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = range ? `${range[0].toFixed(2)}-${range[1].toFixed(2)}` : 'any';
        input.placeholder = 'any';
        input.style.cssText = 'width: 100%; padding: 6px 8px; font-size: 0.75rem; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary); text-align: center;';
        input.addEventListener('focus', (e) => e.target.style.borderColor = 'var(--accent-primary)');
        input.addEventListener('blur', (e) => e.target.style.borderColor = 'var(--border-color)');
        input.addEventListener('change', (e) => {
          const val = e.target.value.trim();
          if (val === 'any' || val === '') {
            biome[key] = null;
          } else {
            const parts = val.split('-');
            if (parts.length === 2) {
              biome[key] = [parseFloat(parts[0]), parseFloat(parts[1])];
            }
          }
          this.refreshPreview();
        });
        return input;
      };
      
      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '×';
      deleteBtn.style.cssText = 'background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1.2rem; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; transition: background 0.2s;';
      deleteBtn.addEventListener('mouseenter', () => deleteBtn.style.background = '#dc2626');
      deleteBtn.addEventListener('mouseleave', () => deleteBtn.style.background = '#ef4444');
      deleteBtn.addEventListener('click', () => {
        biomes.splice(index, 1);
        this.renderBiomeTable(container, biomes);
        this.refreshPreview();
      });
      
      const nameDiv = document.createElement('div');
      nameDiv.appendChild(nameInput);
      const colorDiv = document.createElement('div');
      colorDiv.appendChild(colorInput);
      
      row.appendChild(nameDiv);
      row.appendChild(colorDiv);
      row.appendChild(createRangeInput(biome.height, 'height'));
      row.appendChild(createRangeInput(biome.moisture, 'moisture'));
      row.appendChild(createRangeInput(biome.temperature, 'temperature'));
      row.appendChild(createRangeInput(biome.water, 'water'));
      row.appendChild(deleteBtn);
      
      table.appendChild(row);
    });

    // Add button
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Add Biome';
    addBtn.style.cssText = 'margin-top: 8px; width: 100%; background: var(--accent-primary); color: white; border: none; padding: 6px; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 0.75rem;';
    addBtn.addEventListener('mouseenter', () => {
      addBtn.style.background = 'var(--accent-secondary)';
      addBtn.style.transform = 'translateY(-1px)';
      addBtn.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
    });
    addBtn.addEventListener('mouseleave', () => {
      addBtn.style.background = 'var(--accent-primary)';
      addBtn.style.transform = 'translateY(0)';
      addBtn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
    });
    addBtn.addEventListener('click', () => {
      biomes.push({
        name: 'New Biome',
        color: '#808080',
        height: null,
        moisture: null,
        temperature: null,
        water: [0, 0]
      });
      this.renderBiomeTable(container, biomes);
      this.refreshPreview();
    });

    container.appendChild(table);
    container.appendChild(addBtn);
  }

  renderFeaturesTable(container, features) {
    const table = document.createElement('div');
    table.className = 'features-table param-table';
    table.style.cssText = 'max-height: 320px; overflow-y: auto; overflow-x: hidden; font-size: 0.8rem; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-secondary);';

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display: grid; grid-template-columns: 40px 1.5fr 60px 2fr 80px 50px 50px; gap: 8px; font-weight: 600; padding: 10px 12px; background: var(--bg-tertiary); position: sticky; top: 0; z-index: 1; border-bottom: 2px solid var(--border-color); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary);';
    header.innerHTML = '<div>On</div><div>Name</div><div>Color</div><div>Conditions</div><div>Count</div><div>Edit</div><div></div>';
    table.appendChild(header);

    // Rows
    features.forEach((feature, index) => {
      const row = document.createElement('div');
      row.style.cssText = 'display: grid; grid-template-columns: 40px 1.5fr 60px 2fr 80px 50px 50px; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border-color); align-items: center; transition: background 0.2s;';
      row.addEventListener('mouseenter', () => row.style.background = 'var(--bg-tertiary)');
      row.addEventListener('mouseleave', () => row.style.background = 'transparent');
      
      // Enabled checkbox
      const enabledCheck = document.createElement('input');
      enabledCheck.type = 'checkbox';
      enabledCheck.checked = feature.enabled !== false;
      enabledCheck.style.cssText = 'width: 18px; height: 18px; cursor: pointer; accent-color: var(--accent-primary);';
      enabledCheck.addEventListener('change', (e) => {
        feature.enabled = e.target.checked;
        this.refreshPreview();
      });
      
      // Name
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = feature.name;
      nameInput.style.cssText = 'width: 100%; padding: 6px 8px; font-size: 0.8rem; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary);';
      nameInput.addEventListener('change', (e) => {
        feature.name = e.target.value;
        this.refreshPreview();
      });
      
      // Color
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = feature.color;
      colorInput.style.cssText = 'width: 50px; height: 32px; border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer;';
      colorInput.addEventListener('change', (e) => {
        feature.color = e.target.value;
        this.refreshPreview();
      });
      
      // Conditions summary
      const conditionsDiv = document.createElement('div');
      conditionsDiv.style.cssText = 'font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; padding: 6px 8px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-secondary);';
      const conditions = [];
      if (feature.heightMin !== undefined) conditions.push(`h>${feature.heightMin}`);
      if (feature.heightMax !== undefined) conditions.push(`h<${feature.heightMax}`);
      if (feature.waterMin !== undefined) conditions.push(`w>${feature.waterMin}`);
      if (feature.gradientMin !== undefined) conditions.push(`g>${feature.gradientMin}`);
      if (feature.gradientMax !== undefined) conditions.push(`g<${feature.gradientMax}`);
      conditionsDiv.textContent = conditions.join(' ') || 'any';
      conditionsDiv.title = conditions.join(', ');
      
      // Max count
      const countInput = document.createElement('input');
      countInput.type = 'number';
      countInput.value = feature.maxCount || 50;
      countInput.min = '1';
      countInput.max = '200';
      countInput.style.cssText = 'width: 100%; padding: 6px 8px; font-size: 0.8rem; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary); text-align: center;';
      countInput.addEventListener('change', (e) => {
        feature.maxCount = parseInt(e.target.value);
        this.refreshPreview();
      });
      
      // Edit button (opens detail modal - placeholder for now)
      const editBtn = document.createElement('button');
      editBtn.textContent = '⚙️';
      editBtn.style.cssText = 'background: #6366f1; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; transition: background 0.2s;';
      editBtn.title = 'Edit conditions';
      editBtn.addEventListener('mouseenter', () => editBtn.style.background = '#4f46e5');
      editBtn.addEventListener('mouseleave', () => editBtn.style.background = '#6366f1');
      editBtn.addEventListener('click', () => {
        alert('Feature editor coming soon! Edit thresholds in code for now.');
      });
      
      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '×';
      deleteBtn.style.cssText = 'background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1.2rem; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; transition: background 0.2s;';
      deleteBtn.addEventListener('mouseenter', () => deleteBtn.style.background = '#dc2626');
      deleteBtn.addEventListener('mouseleave', () => deleteBtn.style.background = '#ef4444');
      deleteBtn.addEventListener('click', () => {
        features.splice(index, 1);
        this.renderFeaturesTable(container, features);
        this.refreshPreview();
      });
      
      const enabledDiv = document.createElement('div');
      enabledDiv.appendChild(enabledCheck);
      const nameDiv = document.createElement('div');
      nameDiv.appendChild(nameInput);
      const colorDiv = document.createElement('div');
      colorDiv.appendChild(colorInput);
      const countDiv = document.createElement('div');
      countDiv.appendChild(countInput);
      
      row.appendChild(enabledDiv);
      row.appendChild(nameDiv);
      row.appendChild(colorDiv);
      row.appendChild(conditionsDiv);
      row.appendChild(countDiv);
      row.appendChild(editBtn);
      row.appendChild(deleteBtn);
      
      table.appendChild(row);
    });

    // Add button
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Add Feature Type';
    addBtn.style.cssText = 'margin-top: 8px; width: 100%; background: var(--accent-primary); color: white; border: none; padding: 6px; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 0.75rem;';
    addBtn.addEventListener('mouseenter', () => {
      addBtn.style.background = 'var(--accent-secondary)';
      addBtn.style.transform = 'translateY(-1px)';
      addBtn.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
    });
    addBtn.addEventListener('mouseleave', () => {
      addBtn.style.background = 'var(--accent-primary)';
      addBtn.style.transform = 'translateY(0)';
      addBtn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
    });
    addBtn.addEventListener('click', () => {
      features.push({
        name: 'New Feature',
        color: '#808080',
        enabled: true,
        heightMin: 0.5,
        maxCount: 30
      });
      this.renderFeaturesTable(container, features);
      this.refreshPreview();
    });

    container.appendChild(table);
    container.appendChild(addBtn);
  }

  renderBlockClassifierTables(container, params) {
    const blocks = params.blocks || [];
    const biomeRules = params.biomeRules || [];
    
    // Get connected animation nodes
    const animationNodes = [];
    const incomingAnimations = this.connections.filter(c => 
      c.to === this.selectedNode.id && c.input === 'animations'
    );
    incomingAnimations.forEach(conn => {
      const node = this.nodes.get(conn.from);
      if (node && node.type === 'SurfaceAnimation') {
        animationNodes.push({ id: node.id, name: node.params.name });
      }
    });
    
    console.log(`Found ${animationNodes.length} connected animations:`, animationNodes);
    
    // Two-column layout container
    const twoColContainer = document.createElement('div');
    twoColContainer.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 16px;';
    
    // === LEFT COLUMN: Block Definitions ===
    const leftCol = document.createElement('div');
    
    // Blocks Title
    const blocksTitle = document.createElement('h3');
    blocksTitle.textContent = 'Block Definitions';
    blocksTitle.style.cssText = 'margin: 0 0 8px 0; color: var(--text-primary); font-size: 0.85rem;';
    leftCol.appendChild(blocksTitle);
    
    // Add Block button (above table)
    const addBlockBtn = document.createElement('button');
    addBlockBtn.textContent = '+ Add Block';
    addBlockBtn.style.cssText = 'width: 100%; background: var(--accent-primary); color: white; border: none; padding: 6px; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 0.75rem; margin-bottom: 8px;';
    addBlockBtn.addEventListener('click', () => {
      const newId = blocks.length > 0 ? Math.max(...blocks.map(b => b.id)) + 1 : 0;
      blocks.push({
        id: newId,
        name: 'New Block',
        color: '#808080',
        transparent: 0.0,
        emissive: 0.0,
        reflective: 0.0,
        refractive: 1.0
      });
      this.renderBlockClassifierTables(container, params);
      this.refreshPreview();
    });
    leftCol.appendChild(addBlockBtn);
    
    // Blocks Table
    const blocksTable = document.createElement('div');
    blocksTable.className = 'blocks-table param-table';
    blocksTable.style.cssText = 'max-height: 400px; overflow-y: auto; overflow-x: hidden; font-size: 0.75rem; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-secondary);';

    // Blocks Header
    const blocksHeader = document.createElement('div');
    blocksHeader.style.cssText = 'display: grid; grid-template-columns: 50px 1fr 50px 0.7fr 0.7fr 0.7fr 0.7fr 1.2fr 40px; gap: 8px; font-weight: 600; padding: 10px 12px; background: var(--bg-tertiary); position: sticky; top: 0; z-index: 1; border-bottom: 2px solid var(--border-color); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary);';
    blocksHeader.innerHTML = '<div>ID</div><div>Name</div><div>Color</div><div>Trans</div><div>Emis</div><div>Refl</div><div>Refr</div><div>Anim</div><div></div>';
    blocksTable.appendChild(blocksHeader);

    // Blocks Rows
    blocks.forEach((block, index) => {
      const row = document.createElement('div');
      row.style.cssText = 'display: grid; grid-template-columns: 50px 1fr 50px 0.7fr 0.7fr 0.7fr 0.7fr 1.2fr 40px; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border-color); align-items: center; transition: background 0.2s;';
      row.addEventListener('mouseenter', () => row.style.background = 'var(--bg-tertiary)');
      row.addEventListener('mouseleave', () => row.style.background = 'transparent');
      
      // Ensure block has animationId property
      if (block.animationId === undefined) {
        block.animationId = null;
      }
      
      // ID (readonly)
      const idDiv = document.createElement('div');
      idDiv.textContent = block.id;
      idDiv.style.cssText = 'color: var(--text-secondary); font-size: 0.75rem; text-align: center;';
      
      // Name
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = block.name;
      nameInput.style.cssText = 'width: 100%; padding: 6px 8px; font-size: 0.8rem; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary);';
      nameInput.addEventListener('change', (e) => {
        block.name = e.target.value;
        this.refreshPreview();
      });
      
      // Color
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = block.color;
      colorInput.style.cssText = 'width: 50px; height: 32px; border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer;';
      colorInput.addEventListener('change', (e) => {
        block.color = e.target.value;
        this.refreshPreview();
      });
      
      // Property inputs helper
      const createPropInput = (propName, value) => {
        const input = document.createElement('input');
        input.type = 'number';
        input.value = value;
        input.min = '0';
        input.max = propName === 'refractive' ? '3' : '1';
        input.step = '0.1';
        input.style.cssText = 'width: 100%; padding: 6px 8px; font-size: 0.75rem; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary); text-align: center;';
        input.addEventListener('change', (e) => {
          block[propName] = parseFloat(e.target.value);
          this.refreshPreview();
        });
        return input;
      };
      
      // Animation dropdown
      const animSelect = document.createElement('select');
      animSelect.style.cssText = 'width: 100%; padding: 6px 8px; font-size: 0.7rem; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary);';
      
      // Add "None" option
      const noneOption = document.createElement('option');
      noneOption.value = '';
      noneOption.textContent = 'None';
      animSelect.appendChild(noneOption);
      
      // Add connected animation nodes
      animationNodes.forEach(anim => {
        const option = document.createElement('option');
        option.value = anim.id;
        option.textContent = anim.name;
        animSelect.appendChild(option);
      });
      
      // Set current value
      animSelect.value = block.animationId || '';
      
      animSelect.addEventListener('change', (e) => {
        block.animationId = e.target.value || null;
        this.refreshPreview();
      });
      
      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '×';
      deleteBtn.style.cssText = 'background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1.2rem; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; transition: background 0.2s;';
      deleteBtn.addEventListener('mouseenter', () => deleteBtn.style.background = '#dc2626');
      deleteBtn.addEventListener('mouseleave', () => deleteBtn.style.background = '#ef4444');
      deleteBtn.addEventListener('click', () => {
        blocks.splice(index, 1);
        this.renderBlockClassifierTables(container, params);
        this.refreshPreview();
      });
      
      row.appendChild(idDiv);
      row.appendChild(nameInput);
      row.appendChild(colorInput);
      row.appendChild(createPropInput('transparent', block.transparent || 0));
      row.appendChild(createPropInput('emissive', block.emissive || 0));
      row.appendChild(createPropInput('reflective', block.reflective || 0));
      row.appendChild(createPropInput('refractive', block.refractive || 1.0));
      row.appendChild(animSelect);
      row.appendChild(deleteBtn);
      
      blocksTable.appendChild(row);
    });
    
    leftCol.appendChild(blocksTable);
    
    // === RIGHT COLUMN: Biome Rules ===
    const rightCol = document.createElement('div');
    
    // Rules Title
    const rulesTitle = document.createElement('h3');
    rulesTitle.textContent = 'Biome Rules';
    rulesTitle.style.cssText = 'margin: 0 0 8px 0; color: var(--text-primary); font-size: 0.85rem;';
    rightCol.appendChild(rulesTitle);
    
    // Add Biome Rule button (above table)
    const addRuleBtn = document.createElement('button');
    addRuleBtn.textContent = '+ Add Biome Rule';
    addRuleBtn.style.cssText = 'width: 100%; background: var(--accent-primary); color: white; border: none; padding: 6px; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 0.75rem; margin-bottom: 8px;';
    addRuleBtn.addEventListener('click', () => {
      biomeRules.push({
        biomeId: biomeRules.length,
        biomeName: 'New Biome',
        blocks: [{ blockId: 1, blockName: 'Grass', weight: 1.0 }],
        waterBlocks: [{ blockId: 6, blockName: 'Water', weight: 1.0 }]
      });
      this.renderBlockClassifierTables(container, params);
      this.refreshPreview();
    });
    rightCol.appendChild(addRuleBtn);
    
    // Biome Rules Table
    const rulesTable = document.createElement('div');
    rulesTable.className = 'biome-rules-table param-table';
    rulesTable.style.cssText = 'max-height: 400px; overflow-y: auto; overflow-x: hidden; font-size: 0.75rem; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-secondary);';

    // Rules Header
    const rulesHeader = document.createElement('div');
    rulesHeader.style.cssText = 'display: grid; grid-template-columns: 60px 1.2fr 1.5fr 1.5fr 50px; gap: 8px; font-weight: 600; padding: 10px 12px; background: var(--bg-tertiary); position: sticky; top: 0; z-index: 1; border-bottom: 2px solid var(--border-color); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary);';
    rulesHeader.innerHTML = '<div>Biome</div><div>Name</div><div>Terrain (ID:W)</div><div>Water (ID:W)</div><div></div>';
    rulesTable.appendChild(rulesHeader);

    // Rules Rows
    biomeRules.forEach((rule, index) => {
      const row = document.createElement('div');
      row.style.cssText = 'display: grid; grid-template-columns: 60px 1.2fr 1.5fr 1.5fr 50px; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border-color); align-items: center; transition: background 0.2s;';
      row.addEventListener('mouseenter', () => row.style.background = 'var(--bg-tertiary)');
      row.addEventListener('mouseleave', () => row.style.background = 'transparent');
      
      // Biome ID
      const biomeIdInput = document.createElement('input');
      biomeIdInput.type = 'number';
      biomeIdInput.value = rule.biomeId;
      biomeIdInput.min = '0';
      biomeIdInput.style.cssText = 'width: 100%; padding: 6px 8px; font-size: 0.8rem; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary); text-align: center;';
      biomeIdInput.addEventListener('change', (e) => {
        rule.biomeId = parseInt(e.target.value);
        this.refreshPreview();
      });
      
      // Biome Name (readonly, for reference)
      const biomeName = document.createElement('div');
      biomeName.textContent = rule.biomeName || 'Unknown';
      biomeName.style.cssText = 'color: var(--text-secondary); font-size: 0.8rem;';
      
      // Terrain blocks list (simplified display)
      const terrainBlocks = rule.blocks || [];
      const terrainDisplay = document.createElement('div');
      const terrainSummary = terrainBlocks.map(b => `${b.blockId}:${b.weight}`).join(', ');
      terrainDisplay.textContent = terrainSummary || 'none';
      terrainDisplay.style.cssText = 'font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; padding: 6px 8px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-secondary);';
      terrainDisplay.title = terrainSummary;
      
      // Water blocks list (simplified display)
      const waterBlocks = rule.waterBlocks || [];
      const waterDisplay = document.createElement('div');
      const waterSummary = waterBlocks.map(b => `${b.blockId}:${b.weight}`).join(', ');
      waterDisplay.textContent = waterSummary || 'none';
      waterDisplay.style.cssText = 'font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; padding: 6px 8px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-secondary);';
      waterDisplay.title = waterSummary;
      
      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '×';
      deleteBtn.style.cssText = 'background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1.2rem; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; transition: background 0.2s;';
      deleteBtn.addEventListener('mouseenter', () => deleteBtn.style.background = '#dc2626');
      deleteBtn.addEventListener('mouseleave', () => deleteBtn.style.background = '#ef4444');
      deleteBtn.addEventListener('click', () => {
        biomeRules.splice(index, 1);
        this.renderBlockClassifierTables(container, params);
        this.refreshPreview();
      });
      
      row.appendChild(biomeIdInput);
      row.appendChild(biomeName);
      row.appendChild(terrainDisplay);
      row.appendChild(waterDisplay);
      row.appendChild(deleteBtn);
      
      rulesTable.appendChild(row);
    });
    
    rightCol.appendChild(rulesTable);
    
    // Assemble two-column layout
    twoColContainer.appendChild(leftCol);
    twoColContainer.appendChild(rightCol);
    container.appendChild(twoColContainer);
  }

  renderSurfaceAnimationUI(container, params) {
    // Name input
    const nameGroup = document.createElement('div');
    nameGroup.style.cssText = 'margin-bottom: 16px;';
    
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Animation Name';
    nameLabel.style.cssText = 'display: block; margin-bottom: 6px; font-size: 0.85rem; color: var(--text-secondary);';
    
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = params.name || 'Water Ripples';
    nameInput.style.cssText = 'width: 100%; padding: 8px; font-size: 0.9rem; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary);';
    nameInput.addEventListener('input', (e) => {
      params.name = e.target.value;
      this.refreshPreview();
    });
    
    nameGroup.appendChild(nameLabel);
    nameGroup.appendChild(nameInput);
    container.appendChild(nameGroup);
    
    // Type dropdown
    const typeGroup = document.createElement('div');
    typeGroup.style.cssText = 'margin-bottom: 16px;';
    
    const typeLabel = document.createElement('label');
    typeLabel.textContent = 'Pattern Type';
    typeLabel.style.cssText = 'display: block; margin-bottom: 6px; font-size: 0.85rem; color: var(--text-secondary);';
    
    const typeSelect = document.createElement('select');
    typeSelect.style.cssText = 'width: 100%; padding: 8px; font-size: 0.9rem; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary);';
    
    const types = [
      { value: 'ripples', label: 'Ripples (Multi-octave noise)' },
      { value: 'flow', label: 'Flow (Directional)' },
      { value: 'sway', label: 'Sway (Sine wave)' },
      { value: 'shimmer', label: 'Shimmer (Fast noise)' }
    ];
    
    types.forEach(t => {
      const option = document.createElement('option');
      option.value = t.value;
      option.textContent = t.label;
      typeSelect.appendChild(option);
    });
    
    typeSelect.value = params.type || 'ripples';
    typeSelect.addEventListener('change', (e) => {
      params.type = e.target.value;
      this.refreshPreview();
    });
    
    typeGroup.appendChild(typeLabel);
    typeGroup.appendChild(typeSelect);
    container.appendChild(typeGroup);
    
    // Sliders for parameters
    const sliderParams = [
      { key: 'speed', label: 'Speed', min: 0, max: 2, step: 0.1 },
      { key: 'scale', label: 'Scale', min: 0.05, max: 1, step: 0.01 },
      { key: 'strength', label: 'Strength', min: 0, max: 0.5, step: 0.01 },
      { key: 'octaves', label: 'Octaves', min: 1, max: 5, step: 1 }
    ];
    
    sliderParams.forEach(({ key, label, min, max, step }) => {
      const group = document.createElement('div');
      group.style.cssText = 'margin-bottom: 12px;';
      
      const labelEl = document.createElement('label');
      labelEl.textContent = label;
      labelEl.style.cssText = 'display: block; margin-bottom: 4px; font-size: 0.85rem; color: var(--text-secondary);';
      
      const sliderContainer = document.createElement('div');
      sliderContainer.style.cssText = 'display: flex; align-items: center; gap: 10px;';
      
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = min;
      slider.max = max;
      slider.step = step;
      slider.value = params[key] || (key === 'octaves' ? 3 : key === 'speed' ? 0.5 : key === 'scale' ? 0.15 : 0.08);
      slider.style.cssText = 'flex: 1;';
      
      const valueDisplay = document.createElement('span');
      valueDisplay.textContent = slider.value;
      valueDisplay.style.cssText = 'min-width: 50px; text-align: right; font-family: monospace; font-size: 0.85rem; color: var(--text-primary);';
      
      slider.addEventListener('input', (e) => {
        params[key] = parseFloat(e.target.value);
        valueDisplay.textContent = e.target.value;
        this.refreshPreview();
      });
      
      sliderContainer.appendChild(slider);
      sliderContainer.appendChild(valueDisplay);
      
      group.appendChild(labelEl);
      group.appendChild(sliderContainer);
      container.appendChild(group);
    });
    
    // Direction (for flow type)
    if (params.type === 'flow') {
      const dirGroup = document.createElement('div');
      dirGroup.style.cssText = 'margin-top: 16px;';
      
      const dirLabel = document.createElement('label');
      dirLabel.textContent = 'Flow Direction';
      dirLabel.style.cssText = 'display: block; margin-bottom: 6px; font-size: 0.85rem; color: var(--text-secondary);';
      dirGroup.appendChild(dirLabel);
      
      ['x', 'y'].forEach(axis => {
        const axisGroup = document.createElement('div');
        axisGroup.style.cssText = 'display: flex; align-items: center; gap: 10px; margin-bottom: 8px;';
        
        const axisLabel = document.createElement('span');
        axisLabel.textContent = axis.toUpperCase() + ':';
        axisLabel.style.cssText = 'min-width: 30px; font-size: 0.85rem;';
        
        const axisSlider = document.createElement('input');
        axisSlider.type = 'range';
        axisSlider.min = -1;
        axisSlider.max = 1;
        axisSlider.step = 0.1;
        axisSlider.value = params.direction[axis] || (axis === 'x' ? 1 : 0);
        axisSlider.style.cssText = 'flex: 1;';
        
        const axisValue = document.createElement('span');
        axisValue.textContent = axisSlider.value;
        axisValue.style.cssText = 'min-width: 40px; text-align: right; font-family: monospace; font-size: 0.85rem;';
        
        axisSlider.addEventListener('input', (e) => {
          params.direction[axis] = parseFloat(e.target.value);
          axisValue.textContent = e.target.value;
          this.refreshPreview();
        });
        
        axisGroup.appendChild(axisLabel);
        axisGroup.appendChild(axisSlider);
        axisGroup.appendChild(axisValue);
        dirGroup.appendChild(axisGroup);
      });
      
      container.appendChild(dirGroup);
    }
    
  }
  
  renderAnimationInPreviewPanel(params) {
    // Render animation in the main preview canvas (where visualizer normally renders)
    const previewCanvas = document.getElementById('preview-canvas');
    if (!previewCanvas) return;
    
    // Use the existing preview canvas
    const ctx = previewCanvas.getContext('2d');
    
    // Resize canvas to match container
    const container = previewCanvas.parentElement;
    previewCanvas.width = container.clientWidth;
    previewCanvas.height = Math.min(container.clientHeight, 400);
    let animationFrame = null;
    const startTime = Date.now();
    
    // Simple hash function for noise
    const hash = (x, y) => {
      const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      return h - Math.floor(h);
    };
    
    // Simple 2D noise
    const noise = (x, y) => {
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;
      
      const a = hash(ix, iy);
      const b = hash(ix + 1, iy);
      const c = hash(ix, iy + 1);
      const d = hash(ix + 1, iy + 1);
      
      const ux = fx * fx * (3 - 2 * fx);
      const uy = fy * fy * (3 - 2 * fy);
      
      return a * (1 - ux) * (1 - uy) + 
             b * ux * (1 - uy) + 
             c * (1 - ux) * uy + 
             d * ux * uy;
    };
    
    // Animate preview
    const animate = () => {
      const time = (Date.now() - startTime) / 1000.0 * params.speed;
      
      // Clear
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
      
      // Draw pattern based on type
      const imageData = ctx.createImageData(previewCanvas.width, previewCanvas.height);
      
      for (let y = 0; y < previewCanvas.height; y++) {
        for (let x = 0; x < previewCanvas.width; x++) {
          let value = 0;
          
          if (params.type === 'ripples') {
            // Multi-octave noise
            let amplitude = 1.0;
            let frequency = params.scale * 0.05;
            
            for (let oct = 0; oct < params.octaves; oct++) {
              const nx = x * frequency + time * 0.3 * frequency;
              const ny = y * frequency + time * 0.2 * frequency;
              value += noise(nx, ny) * amplitude;
              frequency *= 2;
              amplitude *= 0.5;
            }
            value = value * params.strength * 5;
            
          } else if (params.type === 'flow') {
            // Directional flow
            const nx = (x + time * 30 * params.direction.x) * params.scale * 0.05;
            const ny = (y + time * 30 * params.direction.y) * params.scale * 0.05;
            value = noise(nx, ny) * params.strength * 5;
            
          } else if (params.type === 'sway') {
            // Sine wave sway
            const phase = x * params.scale * 0.1 + time * params.speed * Math.PI;
            value = Math.sin(phase) * params.strength * 5;
            
          } else if (params.type === 'shimmer') {
            // Fast, subtle variation
            const nx = x * params.scale * 0.1;
            const ny = y * params.scale * 0.1 + time * 2;
            value = noise(nx, ny) * params.strength * 3;
          }
          
          // Map to color (blue gradient for visualization)
          const brightness = Math.floor((value + 1) * 0.5 * 255);
          const idx = (y * previewCanvas.width + x) * 4;
          imageData.data[idx] = brightness * 0.2;
          imageData.data[idx + 1] = brightness * 0.5;
          imageData.data[idx + 2] = brightness;
          imageData.data[idx + 3] = 255;
        }
      }
      
      ctx.putImageData(imageData, 0, 0);
      
      // Add text overlay
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.font = '16px monospace';
      ctx.fillText(`${params.type} - ${params.name}`, 12, previewCanvas.height - 12);
      
      animationFrame = requestAnimationFrame(animate);
    };
    
    animate();
    
    // Cleanup on node deselection
    const stopAnimation = () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
    };
    
    // Store cleanup function
    if (!this.animationCleanups) {
      this.animationCleanups = [];
    }
    this.animationCleanups.push(stopAnimation);
  }
}
