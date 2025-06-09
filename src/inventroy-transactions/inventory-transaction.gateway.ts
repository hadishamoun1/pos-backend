import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class InventoryTransactionGateway {
  @WebSocketServer()
  server: Server;

  sendActivityUpdate(data: any) {
    this.server.emit('inventoryActivityUpdate', data); // 👈 this is the event
  }
}
