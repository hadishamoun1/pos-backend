import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { ClassificationService } from './classification.service';
import { Classification } from '../entities/classification.entity';

@Controller('classifications')
export class ClassificationController {
  constructor(private readonly classificationService: ClassificationService) {}

  @Get()
  findAll() {
    return this.classificationService.findAll();
  }

  @Get(':classificationCode')
  findOne(@Param('classificationCode') classificationCode: string) {
    return this.classificationService.findOne(classificationCode);
  }

  @Post()
  create(@Body() classification: Classification) {
    return this.classificationService.create(classification);
  }

  @Put(':classificationCode')
  update(
    @Param('classificationCode') classificationCode: string,
    @Body() classification: Partial<Classification>,
  ) {
    return this.classificationService.update(
      classificationCode,
      classification,
    );
  }

  @Delete(':classificationCode')
  delete(@Param('classificationCode') classificationCode: string) {
    return this.classificationService.delete(classificationCode);
  }
}
