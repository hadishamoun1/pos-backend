import { Injectable, InternalServerErrorException } from '@nestjs/common';

const SHIPSGO_BASE_URL = 'https://api.shipsgo.com/v2';

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
  private get apiKey(): string {
    const key = process.env.SHIPSGO_API_KEY;
    if (!key) {
      throw new InternalServerErrorException(
        'SHIPSGO_API_KEY is not configured on the server (.env)',
      );
    }
    return key;
  }

  private async request(path: string, init: RequestInit = {}) {
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
  async listShipments(params?: { skip?: number; take?: number }) {
    const qs = new URLSearchParams();
    if (params?.skip != null) qs.set('skip', String(params.skip));
    if (params?.take != null) qs.set('take', String(params.take));
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return this.request(`/ocean/shipments${query}`);
  }

  // GET /ocean/shipments/:id — status, route (ports + dates), containers, movements
  async getShipment(shipmentId: number | string) {
    return this.request(`/ocean/shipments/${shipmentId}`);
  }

  // GET /ocean/shipments/:id/geojson — the live route + current vessel position
  async getShipmentGeoJson(shipmentId: number | string) {
    return this.request(`/ocean/shipments/${shipmentId}/geojson`);
  }

  // POST /ocean/shipments — start tracking a new shipment. Accepts EITHER
  // booking_number OR container_number (or both) — matches invoices that only
  // have one of the two on file. This burns 1 ShipsGo credit per call.
  async createShipment(data: CreateOceanShipmentDto) {
    return this.request('/ocean/shipments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // DELETE /ocean/shipments/:id — stops tracking a shipment on ShipsGo's
  // side entirely (frees up whatever plan slot/credit it was using), used
  // when a wrong BL/shipment was tracked by mistake.
  async deleteShipment(shipmentId: number | string) {
    return this.request(`/ocean/shipments/${shipmentId}`, { method: 'DELETE' });
  }
}
