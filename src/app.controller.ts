import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller('api') // Setting a prefix 'api' for this controller's routes
export class AppController {
  @Get('welcome') // Route for http://localhost:3000/api/welcome
  getWelcomeMessage(): string {
    return 'Welcome to the POS System!';
  }
}