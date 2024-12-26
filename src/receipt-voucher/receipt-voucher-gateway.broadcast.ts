import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: 'http://localhost:3001', // Replace with your frontend origin
    methods: ['GET', 'POST'],
  },
})
export class ReceiptVoucherGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;

  handleConnection(client: any) {
    console.log('Client connected:', client.id);
  }

  handleDisconnect(client: any) {
    console.log('Client disconnected:', client.id);
  }

  // Broadcast receipt vouchers to all connected clients
  broadcastReceiptVouchers(data: any) {
    console.log('Emitting event: receipt-vouchers with data:', data);
    this.server.emit('receipt-vouchers', data);
  }
}
