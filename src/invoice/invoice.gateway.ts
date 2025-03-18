import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: '*', // Adjust as per security requirements
  },
})
export class InvoiceGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  // Called when a client connects to the WebSocket server
  handleConnection(client: Socket) {
    console.log('Client connected:', client.id);
  }

  // Called when a client disconnects
  handleDisconnect(client: Socket) {
    console.log('Client disconnected:', client.id);
  }

  // Called after the gateway is initialized
  afterInit() {
    console.log('WebSocket Gateway Initialized');
  }

  // Emit event to all connected clients
  emitNewInvoice(invoiceData: any) {
    this.server.emit('newInvoice', invoiceData);
  }
}
