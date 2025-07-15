import { WebSocketService } from './services/websocket';

// This will be set by server.ts after initialization
export let wsService: WebSocketService;

export function setWsService(instance: WebSocketService) {
  wsService = instance;
} 