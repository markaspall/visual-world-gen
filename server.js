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

// Ensure storage directory exists
const STORAGE_DIR = path.join(__dirname, 'storage');
try {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
} catch (err) {
  console.error('Failed to create storage directory:', err);
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

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📁 Storage directory: ${STORAGE_DIR}`);
});
