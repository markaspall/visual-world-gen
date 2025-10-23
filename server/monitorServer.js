/**
 * Monitoring Dashboard Server
 * Runs on port 3013, separate from main app
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import monitorRouter from './routes/monitor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3013;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// View engine setup
app.set('views', path.join(__dirname, '../views'));
app.set('view engine', 'ejs');

// Routes
app.use('/monitor', monitorRouter);

// Redirect root to monitor
app.get('/', (req, res) => {
  res.redirect('/monitor');
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Monitor server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n┌──────────────────────────────────────────┐`);
  console.log(`│  📊 V2 Pipeline Monitor Dashboard       │`);
  console.log(`│  http://localhost:${PORT}/monitor          │`);
  console.log(`└──────────────────────────────────────────┘\n`);
});

export default app;
