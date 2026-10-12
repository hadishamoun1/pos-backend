import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';

const VESSELAPI_BASE_URL = 'https://api.vesselapi.com/v1';

export type VesselSearchResult = {
  mmsi: number | string;
  imo: number | string;
  name: string;
  call_sign?: string;
  vessel_type?: string;
  country?: string;
  length?: number;
};

export type VesselPosition = {
  mmsi?: number | string;
  imo?: number | string;
  vessel_name?: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  cog?: number; // course over ground
  sog?: number; // speed over ground, knots
  heading?: number;
  nav_status?: number;
};

// AIS navigational status codes we actually care about (ITU-R M.1371).
// Full list has more (0-15), these are the ones our arrival/underway
// heuristics key off.
export const NAV_STATUS = {
  UNDER_WAY_USING_ENGINE: 0,
  AT_ANCHOR: 1,
  MOORED: 5,
};

@Injectable()
export class VesselTrackingService {
  private readonly logger = new Logger(VesselTrackingService.name);

  private get apiKey(): string {
    const key = process.env.VESSELAPI_KEY;
    if (!key) {
      throw new InternalServerErrorException(
        'VESSELAPI_KEY is not configured on the server (.env) — needed to track chartered/bulk vessels by name.',
      );
    }
    return key;
  }

  private async request(path: string, params: Record<string, string | number> = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
    const query = qs.toString() ? `?${qs.toString()}` : '';

    let res: Response;
    try {
      res = await fetch(`${VESSELAPI_BASE_URL}${path}${query}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
    } catch (err: any) {
      throw new InternalServerErrorException(
        `Could not reach VesselAPI: ${err?.message || err}`,
      );
    }

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      throw new InternalServerErrorException(
        `VesselAPI error (${res.status}): ${body?.message || res.statusText}`,
      );
    }

    return body;
  }

  // GET /search/vessels?filter.name=... — name isn't unique, so this can
  // (and often will) return more than one match; the caller picks the
  // right one and hands its imo/mmsi to getPosition().
  async searchByName(name: string): Promise<VesselSearchResult[]> {
    const body = await this.request('/search/vessels', {
      'filter.name': name,
      'pagination.limit': 20,
    });
    return body?.vessels ?? [];
  }

  // GET /vessel/{imo}/position — IMO is a permanent hull identifier (unlike
  // MMSI, which can be reassigned), so we always look up by IMO when we have
  // one and only fall back to MMSI if it's all we've got.
  async getPosition(idType: 'imo' | 'mmsi', id: string | number): Promise<VesselPosition | null> {
    const body = await this.request(`/vessel/${id}/position`, { 'filter.idType': idType });
    if (!body?.vesselPosition) {
      // Either this vessel genuinely has no recent AIS fix, or the response
      // shape doesn't match what we expect — log the raw body so it's
      // possible to tell which, rather than guessing.
      this.logger.warn(
        `No position data for ${idType}=${id}. Raw VesselAPI response: ${JSON.stringify(body)}`,
      );
    } else {
      // Logged on every successful check (not just failures) so a "why
      // isn't this updating" report can be answered from VesselAPI's own
      // reported AIS timestamp, rather than guessing whether it's stale on
      // their end or something in our own flow isn't actually re-fetching.
      const p = body.vesselPosition;
      this.logger.log(
        `Position for ${idType}=${id}: lat=${p.latitude} lon=${p.longitude} sog=${p.sog} nav_status=${p.nav_status} ais_timestamp=${p.timestamp} fetched_at=${new Date().toISOString()}`,
      );
    }
    return body?.vesselPosition ?? null;
  }
}
