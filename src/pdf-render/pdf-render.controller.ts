import { Body, Controller, Post, Res, UseGuards, BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { PdfRenderService } from './pdf-render.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

// Generic "render this HTML to a PDF" endpoint — any authenticated user can
// use it, since it only renders whatever HTML the caller already built
// client-side (e.g. the same print-ready HTML the Print button already
// generates) and exposes no data of its own.
@Controller('pdf-render')
@UseGuards(JwtAuthGuard)
export class PdfRenderController {
  constructor(private readonly service: PdfRenderService) {}

  @Post()
  async render(
    @Body() body: { html?: string; landscape?: boolean; filename?: string },
    @Res() res: Response,
  ) {
    if (!body?.html || typeof body.html !== 'string') {
      throw new BadRequestException('Provide "html" (a self-contained HTML string) to render.');
    }
    const pdf = await this.service.renderPdf(body.html, { landscape: body.landscape });
    const filename = (body.filename || 'report.pdf').replace(/[^a-zA-Z0-9_.-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  }
}
