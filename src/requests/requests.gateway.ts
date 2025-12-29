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

  // ✅ Send new request to all clients
  notifyNewRequest(newRequest: any) {
    this.server.emit('newRequest', newRequest);
  }

  /**
   * ✅ Emit updated request list in real-time
   */
  sendFilteredRequests(updatedRequests: any) {
    this.server.emit('updateRequests', updatedRequests);


  }



    notifyRequestRemoved(requestId: number) {
    this.server.emit("requestRemoved", { id: requestId });
  }
}
