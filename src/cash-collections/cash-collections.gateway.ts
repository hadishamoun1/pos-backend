// src/cash-collections/cash-collections.gateway.ts
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

export type CashCollectionsChange =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'linked'
  | 'approval-requested'
  | 'approval-approved'
  | 'approval-rejected';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class CashCollectionsGateway {
  @WebSocketServer()
  server: Server;

  // Only says *that* something changed — no row data, because employees may
  // only see their own collections. Each page refetches through the API,
  // which applies those permissions.
  emitChanged(action: CashCollectionsChange, ids: number[] = []) {
    this.server?.emit('cashCollections:changed', { action, ids, at: Date.now() });
  }
}
