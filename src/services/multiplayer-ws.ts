import { ClientMsg, ServerMsg } from '../types/multiplayer';

type MessageHandler<T extends ServerMsg['type']> = (msg: Extract<ServerMsg, { type: T }>) => void;

export class MultiplayerWS {
  private ws: WebSocket | null = null;
  private handlers: Map<string, ((msg: ServerMsg) => void)[]> = new Map();
  private pingInterval: NodeJS.Timeout | null = null;

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      
      this.ws.onopen = () => {
        console.log('WS Connected');
        this.startPing();
        resolve();
      };
      
      this.ws.onerror = (err) => {
        console.error('WS Error', err);
        reject(err);
      };
      
      this.ws.onmessage = (event) => {
        try {
          const msg: ServerMsg = JSON.parse(event.data);
          const handlers = this.handlers.get(msg.type);
          if (handlers) {
            handlers.forEach(h => h(msg));
          }
        } catch (e) {
          console.error('Failed to parse msg', e);
        }
      };
      
      this.ws.onclose = () => {
        console.log('WS Closed');
        this.stopPing();
      };
    });
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  on<T extends ServerMsg['type']>(type: T, handler: MessageHandler<T>) {
    const handlers = this.handlers.get(type) || [];
    handlers.push(handler as (msg: ServerMsg) => void);
    this.handlers.set(type, handlers);
  }

  off<T extends ServerMsg['type']>(type: T, handler?: MessageHandler<T>) {
    if (!handler) {
      this.handlers.delete(type);
    } else {
      const handlers = this.handlers.get(type) || [];
      const idx = handlers.indexOf(handler as (msg: ServerMsg) => void);
      if (idx !== -1) {
        handlers.splice(idx, 1);
        this.handlers.set(type, handlers);
      }
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private startPing() {
    this.pingInterval = setInterval(() => {
      this.send({ type: 'PING' });
    }, 30000);
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}

export const multiplayerWS = new MultiplayerWS();
