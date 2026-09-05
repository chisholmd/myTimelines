import express from 'express';
import cors from 'cors';
import compression from 'compression';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import {
  checkResourcesStatus,
  getCachedAllData,
  handleUploadedFile,
  ensureDirectoryStructure
} from './parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '../dist');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(compression());
app.use(cors());
app.use(express.json({ limit: '100mb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

ensureDirectoryStructure();

// API Endpoint: Get resources status
app.get('/api/resources/status', (req, res) => {
  try {
    const status = checkResourcesStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API Endpoint: Get pre-transformed & cached datasets (Gzip compressed)
app.get('/api/resources/data', (req, res) => {
  try {
    const data = getCachedAllData();
    res.json(data);
  } catch (err) {
    console.error('Error serving resources data:', err);
    res.status(500).json({ error: err.message });
  }
});

// API Endpoint: File Upload with Auto-Detection & Routing
app.post('/api/resources/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const result = handleUploadedFile(req.file.buffer, req.file.originalname);
    const updatedStatus = checkResourcesStatus();

    res.json({
      message: 'File processed successfully',
      detection: result,
      status: updatedStatus,
    });
  } catch (err) {
    console.error('Error handling upload:', err);
    res.status(500).json({ error: err.message });
  }
});

// Serve static assets if dist exists
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`[MyTimeline Server] Express running on http://localhost:${PORT}`);
});
