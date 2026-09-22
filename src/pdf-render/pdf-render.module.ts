import { Module } from '@nestjs/common';
import { PdfRenderService } from './pdf-render.service';
import { PdfRenderController } from './pdf-render.controller';

@Module({
  providers: [PdfRenderService],
  controllers: [PdfRenderController],
  exports: [PdfRenderService],
})
export class PdfRenderModule {}
