// src/receipt-voucher/recievables.gateway.ts
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ namespace: 'recievables', cors: true })
export class RecievablesGateway {
  @WebSocketServer()
  server: Server;

  broadcastAll(entries: any[]) {
    this.server.emit('recievables', entries);
  }
}
