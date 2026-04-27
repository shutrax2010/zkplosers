import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { handleConnection } from './relay.js';
import { rooms } from './rooms.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// CORS
const ALLOWED_ORIGIN = process.env.FRONTEND_ORIGIN ?? '*';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  next();
});

// Health check
app.get('/health', (_, res) => res.json({ ok: true }));

// Serve static files from Next.js build (dist or .next/standalone/public)
// For simplicity in this mono-repo structure on Render:
const frontendDist = path.join(__dirname, '../../dist');
app.use(express.static(frontendDist));

// Inactivity cleanup
setInterval(() => {
  const now = Date.now();
  const TIMEOUT = 30 * 60 * 1000; // 30 minutes
  for (const [id, room] of rooms.entries()) {
    if (now - room.lastActivity > TIMEOUT) {
      console.log(`Cleaning up inactive room: ${id}`);
      rooms.delete(id);
    }
  }
}, 10 * 60 * 1000);

// WebSocket connection handling
wss.on('connection', (ws) => {
  handleConnection(ws);
});

// Upgrade handling
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`WS server running on port ${PORT}`);
});
