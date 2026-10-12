import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ShipsgoService, CreateOceanShipmentDto } from './shipsgo.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerms } from '../auth/permissions.decorator';

@Controller('shipsgo')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ShipsgoController {
  constructor(private readonly shipsgoService: ShipsgoService) {}

  @Get('shipments')
  @RequirePerms('shipmentTracking.view')
  async listShipments(@Query('skip') skip?: string, @Query('take') take?: string) {
    return this.shipsgoService.listShipments({
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Get('shipments/:id')
  @RequirePerms('shipmentTracking.view')
  async getShipment(@Param('id') id: string) {
    return this.shipsgoService.getShipment(id);
  }

  @Get('shipments/:id/geojson')
  @RequirePerms('shipmentTracking.view')
  async getShipmentGeoJson(@Param('id') id: string) {
    return this.shipsgoService.getShipmentGeoJson(id);
  }

  @Post('shipments')
  @RequirePerms('shipmentTracking.view')
  async createShipment(@Body() body: CreateOceanShipmentDto) {
    return this.shipsgoService.createShipment(body);
  }
}
