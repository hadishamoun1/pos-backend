import {
  Controller, Get, Post, Delete,
  Param, Body, Query, Res,
  UseGuards, UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { FileBrowserService } from './file-browser.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerms } from '../auth/permissions.decorator';

@Controller('file-browser')
export class FileBrowserController {
  constructor(private readonly svc: FileBrowserService) {}

  // ── Agent endpoints (shared secret) ───────────────────────────────────────

  @Get('poll/:pcId')
  agentPoll(@Param('pcId') pcId: string, @Query('secret') secret: string) {
    return this.svc.pollCommand(pcId, secret);
  }

  @Post('result/:pcId')
  agentResult(
    @Param('pcId') pcId: string,
    @Query('secret') secret: string,
    @Body() body: Record<string, any>,
  ) {
    return this.svc.postResult(pcId, secret, body);
  }

  @Post('upload/:pcId')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const dir = path.join(process.cwd(), 'uploads', 'file-browser');
          fs.mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (req, file, cb) => {
          const ext = path.extname(file.originalname) || '';
          cb(null, `${req.params.pcId}_${Date.now()}${ext}`);
        },
      }),
    }),
  )
  agentUpload(
    @Param('pcId') pcId: string,
    @Query('secret') secret: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.svc.saveUploadedFile(pcId, secret, file);
  }

  // ── Admin endpoints (JWT + permission) ────────────────────────────────────

  @Post('command/:pcId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePerms('users.manage')
  sendCommand(
    @Param('pcId') pcId: string,
    @Body() body: { type: 'browse' | 'search' | 'download'; payload: Record<string, any> },
  ) {
    return this.svc.sendCommand(pcId, body.type, body.payload);
  }

  @Get('result/:pcId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePerms('users.manage')
  getResult(@Param('pcId') pcId: string) {
    return this.svc.getResult(pcId);
  }

  @Delete('result/:pcId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePerms('users.manage')
  clearResult(@Param('pcId') pcId: string) {
    return this.svc.clearResult(pcId);
  }

  @Get('download/:pcId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePerms('users.manage')
  downloadFile(@Param('pcId') pcId: string, @Res() res: Response) {
    const dl = this.svc.getDownload(pcId);
    if (!dl || !dl.ready || !dl.localPath) {
      res.status(404).json({ message: 'File not ready yet' });
      return;
    }
    if (!fs.existsSync(dl.localPath)) {
      res.status(404).json({ message: 'File not found on server' });
      return;
    }
    res.download(dl.localPath, dl.filename, (err) => {
      if (!err) {
        try { fs.unlinkSync(dl.localPath); } catch {}
      }
    });
  }
}
