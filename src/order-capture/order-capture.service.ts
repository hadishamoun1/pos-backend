import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import * as fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// First step toward "a customer sends a photo of their order on WhatsApp and
// it fills the POS table" — this just asks Claude to describe/transcribe
// whatever's in the image, in plain text, so it can be eyeballed for
// accuracy before any structured item-matching gets built on top of it.
@Injectable()
export class OrderCaptureService {
  private readonly logger = new Logger(OrderCaptureService.name);

  private get client(): Anthropic {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new InternalServerErrorException(
        'ANTHROPIC_API_KEY is not configured on the server (.env).',
      );
    }
    return new Anthropic({ apiKey });
  }

  async analyzeImage(filePath: string, mimeType: string): Promise<{ text: string }> {
    if (!IMAGE_MIME_TYPES.has(mimeType)) {
      throw new InternalServerErrorException(
        `Unsupported image type: ${mimeType}. Use JPEG, PNG, WEBP, or GIF.`,
      );
    }

    const data = fs.readFileSync(filePath).toString('base64');

    const response = await this.client.messages.create({
      // Precision matters more than speed/cost for this tool specifically —
      // it exists to test how well handwriting actually reads, so use the
      // strongest available vision model rather than the cheaper one used
      // for BL extraction (where text is printed, not handwritten).
      model: 'claude-opus-5',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeType as any, data },
            },
            {
              type: 'text',
              text:
                'This is a photo of a handwritten or printed order/inventory form, likely in a ' +
                'mix of Arabic and English. I need an actual best-effort transcription, not a ' +
                'description of the document — never respond with things like "the handwriting ' +
                'is difficult to read" or a summary of how many rows there are instead of reading ' +
                'them.\n\n' +
                'Go cell by cell, row by row, in table order (top to bottom). For each row, report ' +
                'every column that has a table on this form (e.g. Price, Ref No, Item Description, ' +
                'Case, Sheet — use whatever the actual printed column headers are) using this ' +
                'exact format:\n\n' +
                'Row 1: Price=<value>, Ref No=<value>, Item Description=<value>, Case=<value>, ' +
                'Sheet=<value>\n' +
                'Row 2: ...\n\n' +
                'Rules:\n' +
                '- Always give your single best guess for every cell, even if you are not fully ' +
                'certain — do not skip a cell or a row because it is hard to read.\n' +
                '- Keep Arabic text in Arabic — do not translate it.\n' +
                '- Only write "[illegible]" for a cell where you genuinely cannot produce any ' +
                'plausible guess at all, and even then try your best guess first.\n' +
                '- After the table, also transcribe any header fields (e.g. Date, Name, document ' +
                'number) and footer fields (e.g. Total, Signature) the same way — best guess, ' +
                'never skipped.\n' +
                '- If the image is not a form/order list at all, say so plainly instead of forcing ' +
                'this format.',
            },
          ],
        },
      ],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    return { text: text || '(No text returned.)' };
  }
}
