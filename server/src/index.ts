import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { handleConnection } from './relay.js';
import { rooms } from './rooms.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Health check
app.get('/health', (_, res) => res.json({ ok: true }));

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
}, 10 * 60 * 1000); // Check every 10 minutes

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

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`WS server running on port ${PORT}`);
});
