import {
  BadRequestException,
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { RealDescriptionsService } from './itemNameRealDescription.service';

@Controller('real-descriptions')
export class RealDescriptionsController {
  constructor(private readonly svc: RealDescriptionsService) {}

  // GET /real-descriptions?q=&withCounts=1|true|yes
  @Get()
  async list(@Query() query: any) {
    const q = typeof query.q === 'string' ? query.q : undefined;

    let withCounts: boolean | undefined;
    if (query.withCounts !== undefined) {
      const s = String(query.withCounts).toLowerCase().trim();
      withCounts = s === '1' || s === 'true' || s === 'yes';
    }

    return this.svc.listSorted({ q, withCounts: withCounts ?? false });
  }

  // PUT /real-descriptions/reorder  body: { order: number[] }
  @Put('reorder')
  async reorder(@Body() body: any) {
    if (!body || !Array.isArray(body.order) || body.order.length === 0) {
      throw new BadRequestException('Body must be { order: number[] } with at least one id.');
    }
    const order = body.order.map((x: any) => Number(x));
    const invalid = order.filter((n: number) => !Number.isInteger(n) || n < 1);
    if (invalid.length) {
      throw new BadRequestException(
        `Order must be an array of positive integer IDs. Invalid: [${invalid.join(', ')}]`,
      );
    }
    await this.svc.reorder(order);
    return { ok: true };
  }

  // POST /real-descriptions
  @Post()
  async create(@Body() body: any) {
    return this.svc.create(body);
  }

  // GET /real-descriptions/:id
  @Get(':id')
  async getOne(@Param('id') idParam: string) {
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('id must be a positive integer.');
    }
    return this.svc.getOne(id);
  }

  // PUT /real-descriptions/:id
  @Put(':id')
  async update(@Param('id') idParam: string, @Body() body: any) {
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('id must be a positive integer.');
    }
    return this.svc.update(id, body);
  }

  // DELETE /real-descriptions/:id
  @Delete(':id')
  async remove(@Param('id') idParam: string) {
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('id must be a positive integer.');
    }
    return this.svc.remove(id);
  }
}
