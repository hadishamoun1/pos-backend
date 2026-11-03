// src/pos-controls/pos-controls.gateway.ts
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { PosControls } from '../entities/pos-controls.entity';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class PosControlsGateway {
  @WebSocketServer()
  server: Server;

  // The controls are on/off switches (no private data), so the new values
  // are sent directly and pages apply them without another request.
  emitChanged(controls: PosControls) {
    this.server?.emit('posControls:changed', controls);
  }
}
