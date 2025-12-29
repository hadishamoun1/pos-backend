import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";

@WebSocketGateway({
  cors: { origin: true, credentials: true },
})
export class InvoiceGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    console.log("Client connected:", client.id);
  }

  handleDisconnect(client: Socket) {
    console.log("Client disconnected:", client.id);
  }

  afterInit() {
    console.log("WebSocket Gateway Initialized");
  }

  emitNewInvoice(invoiceData: any) {
    this.server.emit("newInvoice", invoiceData);
  }

  emitInvoiceUpdated(invoiceData: any) {
    this.server.emit("invoiceUpdated", invoiceData);
  }


  // invoice.gateway.ts
emitRequestRemoved(requestId: number) {
  this.server.emit("requestRemoved", { id: requestId });
}

}
