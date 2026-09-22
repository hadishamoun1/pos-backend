import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer';

// Renders arbitrary print-ready HTML (already self-contained — its own
// <style>, RTL/Arabic text, etc.) to a PDF using a real headless browser.
// This exists specifically because client-side "screenshot every page and
// embed it as an image" approaches (html2canvas + jsPDF) don't scale — a
// long report turns into hundreds of embedded raster images, which blows
// past the browser's max string length when jsPDF assembles the final
// document. A headless browser's native print-to-PDF has no such limit and
// renders Arabic/RTL correctly since it's genuine browser text rendering,
// not a font embedded and manually shaped in a PDF library.
@Injectable()
export class PdfRenderService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfRenderService.name);
  private browserPromise: Promise<Browser> | null = null;

  // One shared browser instance, reused across requests (launching Chromium
  // per-request would be slow and wasteful) — a fresh page/tab per render.
  private async getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = puppeteer
        .launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        })
        .catch((err) => {
          this.browserPromise = null;
          throw err;
        });
    }
    return this.browserPromise;
  }

  async renderPdf(html: string, options?: { landscape?: boolean }): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      // The HTML is fully self-contained (inline <style>, no external
      // resources), so 'load' is enough — setContent()'s type no longer
      // accepts the networkidle* variants in this Puppeteer version anyway.
      await page.setContent(html, { waitUntil: 'load' });

      const landscape = options?.landscape ?? false;
      const MARGIN_MM = 10;
      const pageWidthMm = landscape ? 297 : 210;
      const usableWidthPx = ((pageWidthMm - MARGIN_MM * 2) / 25.4) * 96; // CSS px at 96dpi

      // page.pdf() renders at actual size — unlike a browser's interactive
      // print dialog, it does NOT auto-shrink wide content to fit the page.
      // Measure how wide the report actually laid out and scale it down
      // proportionally so every column stays visible, matching what the
      // print dialog's "fit to printable area" already does for free.
      const contentWidthPx = await page.evaluate(() => document.body.scrollWidth);
      const fitScale = contentWidthPx > 0 ? Math.min(1, usableWidthPx / contentWidthPx) : 1;

      const pdf = await page.pdf({
        format: 'A4',
        landscape,
        printBackground: true,
        margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
        scale: Math.max(0.1, fitScale),
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }

  async onModuleDestroy() {
    if (this.browserPromise) {
      try {
        const browser = await this.browserPromise;
        await browser.close();
      } catch (err: any) {
        this.logger.warn(`Failed to close Puppeteer browser cleanly: ${err?.message || err}`);
      }
    }
  }
}
