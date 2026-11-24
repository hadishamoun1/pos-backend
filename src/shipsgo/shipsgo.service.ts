import { Injectable, InternalServerErrorException } from '@nestjs/common';

const SHIPSGO_BASE_URL = 'https://api.shipsgo.com/v2';

// Short-lived cache for the Shipment Tracking page's reads. ShipsGo refreshes
// positions far less often than this, and every page visit used to re-ask
// for the list plus every shipment's route — slow, and enough requests at
// once to get some of them rate-limited (those then never showed on the map).
const LIST_TTL_MS = 2 * 60 * 1000;
const GEOJSON_TTL_MS = 10 * 60 * 1000;

export type CreateOceanShipmentDto = {
  reference: string;
  booking_number?: string;
  container_number?: string;
  // The shipping line carrying this booking/container. ShipsGo needs this to
  // know which carrier's tracking system to query — without it, lookups for
  // anything but the handful of biggest lines (Maersk/MSC/...) can silently
  // fail to resolve. Must match ShipsGo's own shipping-line list exactly
  // (https://shipsgo.com/ocean/carriers); fall back to 'OTHERS' if unknown.
  carrier?: string;
  followers?: string[];
  tags?: string[];
};

@Injectable()
export class ShipsgoService {
  private readonly cache = new Map<string, { at: number; value: any }>();

  private async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = await load();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  private clearListCache() {
    for (const key of this.cache.keys()) if (key.startsWith('list:')) this.cache.delete(key);
  }

  private get apiKey(): string {
    const key = process.env.SHIPSGO_API_KEY;
    if (!key) {
      throw new InternalServerErrorException(
        'SHIPSGO_API_KEY is not configured on the server (.env)',
      );
    }
    return key;
  }

  private async request(path: string, init: RequestInit = {}, attempt = 0) {
    let res: Response;
    try {
      res = await fetch(`${SHIPSGO_BASE_URL}${path}`, {
        ...init,
        headers: {
          'X-Shipsgo-User-Token': this.apiKey,
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
      });
    } catch (err: any) {
      throw new InternalServerErrorException(
        `Could not reach ShipsGo: ${err?.message || err}`,
      );
    }

    // Rate-limited: wait (Retry-After, capped at 3s) and try once more.
    if (res.status === 429 && attempt === 0) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs = Math.min(3000, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000);
      await new Promise((r) => setTimeout(r, waitMs));
      return this.request(path, init, attempt + 1);
    }

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      throw new InternalServerErrorException(
        `ShipsGo API error (${res.status}): ${body?.message || res.statusText}`,
      );
    }

    return body;
  }

  // GET /ocean/carriers — the fixed list of carrier codes ShipsGo's
  // `carrier` field on createShipment() actually accepts (a free-text
  // shipping-line name gets rejected with a 422 "invalid format").
  async listCarriers() {
    const body = await this.request('/ocean/carriers');
    return body?.carriers ?? body?.data ?? (Array.isArray(body) ? body : []);
  }

  // GET /ocean/shipments — list everything currently tracked on this ShipsGo account
  async listShipments(params?: { skip?: number; take?: number; fresh?: boolean }) {
    if (params?.fresh) this.clearListCache();
    const qs = new URLSearchParams();
    if (params?.skip != null) qs.set('skip', String(params.skip));
    if (params?.take != null) qs.set('take', String(params.take));
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return this.cached(`list:${query}`, LIST_TTL_MS, () => this.request(`/ocean/shipments${query}`));
  }

  // GET /ocean/shipments/:id — status, route (ports + dates), containers, movements
  async getShipment(shipmentId: number | string) {
    return this.request(`/ocean/shipments/${shipmentId}`);
  }

  // GET /ocean/shipments/:id/geojson — the live route + current vessel position
  async getShipmentGeoJson(shipmentId: number | string) {
    return this.cached(`geo:${shipmentId}`, GEOJSON_TTL_MS, () =>
      this.request(`/ocean/shipments/${shipmentId}/geojson`),
    );
  }

  // POST /ocean/shipments — start tracking a new shipment. Accepts EITHER
  // booking_number OR container_number (or both) — matches invoices that only
  // have one of the two on file. This burns 1 ShipsGo credit per call.
  async createShipment(data: CreateOceanShipmentDto) {
    const result = await this.request('/ocean/shipments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    this.clearListCache(); // show the new shipment on the next page load
    return result;
  }

  // DELETE /ocean/shipments/:id — stops tracking a shipment on ShipsGo's
  // side entirely (frees up whatever plan slot/credit it was using), used
  // when a wrong BL/shipment was tracked by mistake.
  async deleteShipment(shipmentId: number | string) {
    const result = await this.request(`/ocean/shipments/${shipmentId}`, { method: 'DELETE' });
    this.clearListCache();
    this.cache.delete(`geo:${shipmentId}`);
    return result;
  }
}
