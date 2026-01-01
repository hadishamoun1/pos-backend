// src/receipt-voucher/recievables.gateway.ts
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ 
  cors: {
    origin: '*', // ✅ Allow all origins in dev (restrict in production)
    credentials: true,
  },
})
export class RecievablesGateway {
  @WebSocketServer()
  server: Server;

  broadcastAll(entries: any[]) {
    console.log('📡 Broadcasting receivables update to all clients:', entries.length, 'entries');
    this.server.emit('recievables', entries);
  }
}