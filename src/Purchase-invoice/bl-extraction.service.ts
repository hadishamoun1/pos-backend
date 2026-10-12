import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import * as fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

const BlExtractionSchema = z.object({
  blNumber: z.string().nullable(),
  found: z.boolean(),
  // Only meaningful on a charter-party BL (e.g. a CONGENBILL form) — the
  // named vessel carrying the cargo, e.g. 'M/V SITIA' -> 'SITIA'. Null on a
  // normal liner BL where there's a shipping line/carrier instead.
  vesselName: z.string().nullable(),
  // The container number, when the document is a normal container shipment
  // (whether or not blNumber turned out to be a usable carrier reference —
  // this matters specifically when it's a freight forwarder's house bill,
  // whose own BL number ShipsGo can't resolve but whose container number
  // still can). If several containers are listed, the first one.
  containerNumber: z.string().nullable(),
  // The carrier/shipping line operating the vessel (e.g. "CMA CGM",
  // "Maersk", "MSC") — matters a lot for BL-number-based ShipsGo tracking
  // specifically, since a booking number alone doesn't self-identify its
  // carrier the way a container number does. Null on a charter-party BL
  // (no liner carrier at all).
  shippingLine: z.string().nullable(),
});

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export type BlExtractionResult = {
  blNumber: string | null;
  found: boolean;
  vesselName: string | null;
  containerNumber: string | null;
  shippingLine: string | null;
};

@Injectable()
export class BlExtractionService {
  private readonly logger = new Logger(BlExtractionService.name);

  private get client(): Anthropic {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new InternalServerErrorException(
        'ANTHROPIC_API_KEY is not configured on the server (.env) — needed to read BL numbers from an uploaded scan.',
      );
    }
    return new Anthropic({ apiKey });
  }

  // Reads the uploaded scan and asks Claude to find the Bill of Lading
  // number (plus vessel name / container number / shipping line where
  // present) on it. Never throws for "couldn't find one" — only for actual
  // request/config failures — so a bad scan just means the user types
  // things in by hand instead of blocking the upload.
  async extractBlNumber(filePath: string, mimeType: string): Promise<BlExtractionResult> {
    const data = fs.readFileSync(filePath).toString('base64');
    const isPdf = mimeType === 'application/pdf';
    const empty: BlExtractionResult = {
      blNumber: null,
      found: false,
      vesselName: null,
      containerNumber: null,
      shippingLine: null,
    };

    if (!isPdf && !IMAGE_MIME_TYPES.has(mimeType)) {
      // Unsupported type for vision — caller already validated the upload
      // itself, this just skips extraction gracefully.
      return empty;
    }

    const contentBlock = isPdf
      ? {
          type: 'document' as const,
          source: { type: 'base64' as const, media_type: 'application/pdf' as const, data },
        }
      : {
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: mimeType as any, data },
        };

    try {
      const response = await this.client.messages.parse({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              contentBlock,
              {
                type: 'text',
                text:
                  'This is a scanned Bill of Lading (B/L) or waybill document. Extract four ' +
                  'things:\n\n' +
                  '1. blNumber: the Bill of Lading / waybill number — labeled "B/L No.", ' +
                  '"Bill of Lading No.", "BL Number", "Waybill Number", "MBL No.", "Master B/L", ' +
                  'or similar. Report it exactly as printed, including any letters/dashes. If ' +
                  'you cannot find one, set found to false and blNumber to null.\n\n' +
                  '2. vesselName: almost every BL has a "Vessel" field naming the ship, but this ' +
                  'field is ONLY meaningful here for a charter-party BL (a document with no ' +
                  'shipping line/carrier at all — often explicitly marked "CONGENBILL", "TO BE ' +
                  'USED WITH CHARTER-PARTIES", or similar). If the document shows a carrier/' +
                  'shipping line name or logo anywhere (e.g. CMA CGM, Maersk, MSC, COSCO, ' +
                  'Hapag-Lloyd, Evergreen, ONE, etc.) — even if it ALSO has a "Vessel" field — ' +
                  'this is a normal liner shipment, not a charter, so vesselName MUST be null. ' +
                  'Only report a name (written without the "M/V" prefix) when there is clearly ' +
                  'no carrier/shipping line on the document at all.\n\n' +
                  '3. containerNumber: the container number, if this is a containerized shipment ' +
                  '— labeled "Container No.", "Marks and Numbers", "Container/Seal", or shown in ' +
                  'a table listing container numbers (format is 4 letters + 7 digits, e.g. ' +
                  'TCLU7716090). If several containers are listed, report just the first one. ' +
                  'Null if this is break-bulk/charter cargo with no container.\n\n' +
                  '4. shippingLine: the carrier/shipping line operating the vessel — usually shown ' +
                  'as a company name and/or logo near the top of the document (e.g. "CMA CGM", ' +
                  '"Maersk", "MSC", "COSCO", "Hapag-Lloyd", "Evergreen", "ONE"). Report the name ' +
                  'as printed. Null if this is a charter-party BL with no liner carrier at all.',
              },
            ],
          },
        ],
        output_config: {
          format: zodOutputFormat(BlExtractionSchema),
        },
      });

      if (!response.parsed_output) {
        return empty;
      }
      return {
        blNumber: response.parsed_output.blNumber ?? null,
        found: response.parsed_output.found,
        vesselName: response.parsed_output.vesselName ?? null,
        containerNumber: response.parsed_output.containerNumber ?? null,
        shippingLine: response.parsed_output.shippingLine ?? null,
      };
    } catch (err: any) {
      this.logger.error(`BL extraction failed: ${err?.message || err}`);
      // Extraction failing shouldn't block the upload itself — the file is
      // still saved, the user just fills things in manually.
      return empty;
    }
  }
}
