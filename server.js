import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { apiRouter } from './tracker/api.js';
import { initDb, addLog } from './tracker/db.js';

dotenv.config();

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught Exception:', err?.stack || err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Rejection:', reason?.stack || reason);
});

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || `http://localhost:${PORT},http://127.0.0.1:${PORT}`).split(',').map(s => s.trim()).filter(Boolean);

// Initialize Database
initDb();

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.startsWith('chrome-extension://')) return callback(null, true);
    return callback(new Error('Origin not allowed by local API'));
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Dashboard Static Files
const publicDir = path.join(process.cwd(), 'tracker', 'public');
app.use(express.static(publicDir));

// Mount REST API
app.use('/api', apiRouter);

// Fallback route to serve web dashboard
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' });
  }
  const indexPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send('Dashboard static files not found.');
  }
});

// Start Server
if (process.argv[1]?.endsWith('server.js') || !process.env.TEST_MODE) {
  app.listen(PORT, HOST, () => {
    console.log(`\n======================================================`);
    console.log(`  🚀 Job Application Agent Server Online`);
    console.log(`  📊 Dashboard UI:     http://${HOST}:${PORT}`);
    console.log(`  🔌 REST API Base:    http://${HOST}:${PORT}/api`);
    console.log(`======================================================\n`);
    addLog(null, 'info', `Server started on http://localhost:${PORT}`);

    // Automatically initialize background orchestrator (polls email & auto-fills in browser tabs)
    if (!process.env.TEST_MODE && process.env.ENABLE_ORCHESTRATOR !== 'false') {
      import('./orchestrator.js').catch(err => {
        console.warn('[Server] Could not initialize orchestrator:', err.message);
      });
    }
  });
}

export default app;
