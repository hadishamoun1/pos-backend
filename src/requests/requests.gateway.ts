import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: '*', // Adjust as per security requirements
  },
})
export class RequestGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  handleConnection(client: any) {
    console.log(`🔵 Client connected: ${client.id}`);
  }

  handleDisconnect(client: any) {
    console.log(`🔴 Client disconnected: ${client.id}`);
  }

  /**
   * ✅ Emit updated request list in real-time
   */
  sendFilteredRequests(updatedRequests: any) {
    this.server.emit('updateRequests', updatedRequests);
  }
}
