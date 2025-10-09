import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3012;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Ensure storage directories exist
const STORAGE_DIR = path.join(__dirname, 'storage');
const WORLDS_DIR = path.join(STORAGE_DIR, 'worlds');
try {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  await fs.mkdir(WORLDS_DIR, { recursive: true });
} catch (err) {
  console.error('Failed to create storage directories:', err);
}

// Routes
app.get('/', (req, res) => {
  res.render('index', {
    title: 'Procedural World Generator'
  });
});

app.get('/world', (req, res) => {
  res.render('world', {
    title: 'Enter World - Procedural World Generator'
  });
});

// Save graph configuration
app.post('/api/save', async (req, res) => {
  try {
    const { id, graph, metadata } = req.body;
    const filename = `${id || Date.now()}.json`;
    await fs.writeFile(
      path.join(STORAGE_DIR, filename),
      JSON.stringify({ graph, metadata }, null, 2)
    );
    res.json({ success: true, id: filename });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Load graph configuration
app.get('/api/load/:id', async (req, res) => {
  try {
    const data = await fs.readFile(
      path.join(STORAGE_DIR, req.params.id),
      'utf-8'
    );
    res.json(JSON.parse(data));
  } catch (error) {
    res.status(404).json({ success: false, error: 'Not found' });
  }
});

// List saved graphs
app.get('/api/list', async (req, res) => {
  try {
    const files = await fs.readdir(STORAGE_DIR);
    const graphs = await Promise.all(
      files
        .filter(f => f.endsWith('.json'))
        .map(async (file) => {
          const data = await fs.readFile(path.join(STORAGE_DIR, file), 'utf-8');
          const parsed = JSON.parse(data);
          return {
            id: file,
            metadata: parsed.metadata || {},
            timestamp: (await fs.stat(path.join(STORAGE_DIR, file))).mtime
          };
        })
    );
    res.json(graphs);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// World API endpoints
// Save world files
app.post('/api/worlds/:worldId', async (req, res) => {
  try {
    const { worldId } = req.params;
    const { files } = req.body; // { 'filename.png': base64data, 'world.json': jsonString }
    
    const worldDir = path.join(WORLDS_DIR, worldId);
    await fs.mkdir(worldDir, { recursive: true });
    
    // Save each file
    for (const [filename, data] of Object.entries(files)) {
      const filepath = path.join(worldDir, filename);
      
      if (filename.endsWith('.png')) {
        // Decode base64 PNG
        const base64Data = data.replace(/^data:image\/png;base64,/, '');
        await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
      } else if (filename.endsWith('.json')) {
        // Save JSON string
        await fs.writeFile(filepath, data);
      }
    }
    
    console.log(`✅ Saved world: ${worldId}`);
    res.json({ success: true, worldId });
  } catch (error) {
    console.error('Failed to save world:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// List available worlds
app.get('/api/worlds', async (req, res) => {
  try {
    const worlds = await fs.readdir(WORLDS_DIR);
    const worldList = await Promise.all(
      worlds.map(async (worldId) => {
        const worldDir = path.join(WORLDS_DIR, worldId);
        const stat = await fs.stat(worldDir);
        
        if (!stat.isDirectory()) return null;
        
        // Try to read manifest
        const manifestPath = path.join(worldDir, 'world.json');
        let manifest = null;
        try {
          const data = await fs.readFile(manifestPath, 'utf-8');
          manifest = JSON.parse(data);
        } catch {}
        
        return {
          id: worldId,
          seed: manifest?.seed || worldId,
          resolution: manifest?.resolution || 512,
          created: stat.mtime
        };
      })
    );
    
    res.json(worldList.filter(w => w !== null));
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get world data
app.get('/api/worlds/:worldId', async (req, res) => {
  try {
    const { worldId } = req.params;
    const manifestPath = path.join(WORLDS_DIR, worldId, 'world.json');
    const data = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(data);
    
    // Update file paths to point to server URLs
    if (manifest.files) {
      for (const [key, filename] of Object.entries(manifest.files)) {
        manifest.files[key] = `/api/worlds/${worldId}/files/${filename}`;
      }
    }
    
    res.json(manifest);
  } catch (error) {
    res.status(404).json({ success: false, error: 'World not found' });
  }
});

// Get world file (PNG)
app.get('/api/worlds/:worldId/files/:filename', async (req, res) => {
  try {
    const { worldId, filename } = req.params;
    const filepath = path.join(WORLDS_DIR, worldId, filename);
    
    console.log(`📁 Serving file: ${filepath}`);
    
    // Check if file exists
    await fs.access(filepath);
    
    // Serve with correct content type
    if (filename.endsWith('.png')) {
      res.contentType('image/png');
    }
    
    res.sendFile(filepath);
  } catch (error) {
    console.error(`❌ File not found: ${filepath}`, error);
    res.status(404).json({ success: false, error: 'File not found' });
  }
});

// Render world viewer page (ray marcher)
app.get('/worlds/:worldId', (req, res) => {
  res.render('world', {
    worldId: req.params.worldId
  });
});

// Render mesh renderer page (hybrid)
app.get('/worlds/:worldId/mesh', (req, res) => {
  res.render('worldMesh', {
    worldId: req.params.worldId
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📁 Storage directory: ${STORAGE_DIR}`);
  console.log(`🌍 Worlds directory: ${WORLDS_DIR}`);
});
