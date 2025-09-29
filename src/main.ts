// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  // Let us control CORS explicitly
  const app = await NestFactory.create(AppModule, { cors: false });

  // Frontend origin(s)
  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:3001';

  app.enableCors({
    // Allow localhost:3001 and common private LAN IPs on port 3001
    origin: [
      clientOrigin,
      'http://localhost:3001',
      /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:3001$/,
    /^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}:3001$/,
    /^http:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}:3001$/,
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = Number(process.env.PORT || 3000);
  // Bind to all interfaces so other PCs can connect
  await app.listen(port, '0.0.0.0');
  console.log(`API listening on http://0.0.0.0:${port}`);
  console.log(`Allowed frontend origin(s): ${clientOrigin} (+ LAN regex)`);
}
bootstrap();
