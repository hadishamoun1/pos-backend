// src/transfers/transfers.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { Transfer } from '../entities/inventory/transfer.entity';

@Controller('transfers')
export class TransfersController {
  constructor(private readonly svc: TransfersService) {}

  @Post()
  create(@Body() body: any): Promise<Transfer> {
    return this.svc.create(body);
  }

  @Get('v1/details')
  async findDetails() {
    const raws = await this.svc.finddetails();
    return raws.map((t) => ({
      id: t.id,
      transferNumber: t.transferNumber,
      date: t.date,
      type: t.type,
      location: t.location,
      createdAt: t.createdAt,
      items: t.items.map((i) => ({
        id: i.id,
        transferId: i.transferId,
        itemVariantId: i.itemVariantId,
        quantity: i.quantity,
        sqm: i.sqm,
        price: i.price,
        length: i.itemVariant.length,
        width: i.itemVariant.width,
        sheetsPerBox: i.itemVariant.sheetsPerBox,
        origin: i.itemVariant.origin,
        thickness: i.itemVariant.thickness.thickness,
        itemName: i.itemVariant.thickness.item.itemName,
        itemType: i.itemVariant.thickness.item.type,
      })),
    }));
  }

  @Get()
  findAll(): Promise<Transfer[]> {
    return this.svc.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Transfer> {
    return this.svc.findOne(id);
  }
}
