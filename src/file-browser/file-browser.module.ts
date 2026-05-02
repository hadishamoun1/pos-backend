import { Module } from '@nestjs/common';
import { FileBrowserController } from './file-browser.controller';
import { FileBrowserService } from './file-browser.service';

@Module({
  controllers: [FileBrowserController],
  providers:   [FileBrowserService],
})
export class FileBrowserModule {}
