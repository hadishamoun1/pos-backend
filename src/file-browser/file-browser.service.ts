import { Injectable, ForbiddenException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface Command {
  id: string;
  type: 'browse' | 'search' | 'download';
  payload: Record<string, any>;
  issuedAt: number;
}

export interface CommandResult {
  commandId: string;
  type: string;
  data: Record<string, any>;
  receivedAt: number;
}

export interface PendingDownload {
  commandId: string;
  filename: string;
  localPath: string;
  ready: boolean;
}

@Injectable()
export class FileBrowserService {
  private readonly pendingCommands  = new Map<string, Command>();
  private readonly results          = new Map<string, CommandResult>();
  private readonly pendingDownloads = new Map<string, PendingDownload>();

  readonly uploadDir = path.join(process.cwd(), 'uploads', 'file-browser');

  constructor() {
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  private checkSecret(secret: string) {
    const expected = (process.env.RECORDING_SECRET || 'rec-secret-change-me').trim();
    if (secret !== expected) throw new ForbiddenException('Invalid secret');
  }

  // ── Agent endpoints ────────────────────────────────────────────────────────

  pollCommand(pcId: string, secret: string) {
    this.checkSecret(secret);
    const cmd = this.pendingCommands.get(pcId);
    if (!cmd) return { type: 'idle' };
    this.pendingCommands.delete(pcId);
    return cmd;
  }

  postResult(pcId: string, secret: string, body: Record<string, any>) {
    this.checkSecret(secret);
    this.results.set(pcId, {
      commandId:  body.commandId ?? '',
      type:       body.type      ?? 'unknown',
      data:       body,
      receivedAt: Date.now(),
    });
    return { ok: true };
  }

  saveUploadedFile(pcId: string, secret: string, file: Express.Multer.File) {
    this.checkSecret(secret);
    const dl = this.pendingDownloads.get(pcId);
    if (dl) {
      dl.localPath = file.path;
      dl.filename  = file.originalname;
      dl.ready     = true;
    }
    return { ok: true };
  }

  // ── Admin endpoints ────────────────────────────────────────────────────────

  sendCommand(pcId: string, type: 'browse' | 'search' | 'download', payload: Record<string, any>) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.pendingCommands.set(pcId, { id, type, payload, issuedAt: Date.now() });
    this.results.delete(pcId);

    if (type === 'download') {
      const prev = this.pendingDownloads.get(pcId);
      if (prev?.localPath) {
        try { fs.unlinkSync(prev.localPath); } catch {}
      }
      this.pendingDownloads.set(pcId, {
        commandId: id,
        filename:  path.basename(payload.path ?? 'file'),
        localPath: '',
        ready:     false,
      });
    }

    return { commandId: id };
  }

  getResult(pcId: string) {
    return this.results.get(pcId) ?? null;
  }

  getDownload(pcId: string): PendingDownload | null {
    return this.pendingDownloads.get(pcId) ?? null;
  }

  clearResult(pcId: string) {
    this.results.delete(pcId);
    this.pendingCommands.delete(pcId);
    return { ok: true };
  }
}
