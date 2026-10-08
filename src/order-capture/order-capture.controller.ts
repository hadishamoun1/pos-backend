import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { OrderCaptureService } from './order-capture.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerms } from '../auth/permissions.decorator';

const uploadDir = path.join(process.cwd(), 'uploads', 'order-capture');
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

@Controller('order-capture')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrderCaptureController {
  constructor(private readonly service: OrderCaptureService) {}

  @Post('analyze-image')
  @RequirePerms('orderCapture.view')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          fs.mkdirSync(uploadDir, { recursive: true });
          cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
          const ts = Date.now();
          const ext = path.extname(file.originalname) || '';
          cb(null, `capture_${ts}${ext}`);
        },
      }),
      limits: { fileSize: 15 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        cb(null, ALLOWED_MIME_TYPES.includes(file.mimetype));
      },
    }),
  )
  async analyzeImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException(
        'No file received, or it was rejected — only JPEG, PNG, WEBP, or GIF are accepted.',
      );
    }
    try {
      return await this.service.analyzeImage(file.path, file.mimetype);
    } finally {
      // One-off test upload — no need to keep it around afterward.
      fs.unlink(file.path, () => {});
    }
  }
}
