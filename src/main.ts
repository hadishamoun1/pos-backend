// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import { join } from 'path';

async function bootstrap() {
  // ✅ Create app as NestExpressApplication to enable static file serving
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: false });

  // ✅ Increase JSON/body size limit (fixes: PayloadTooLargeError)
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // ✅ Serve static files from uploads directory
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads/',
  });

  // Frontend origin(s)
  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:3000';

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (clientOrigin && origin === clientOrigin) return callback(null, true);

      if (origin === 'http://localhost:3000') return callback(null, true);
      if (origin === 'http://localhost:5173') return callback(null, true);
      if (origin === 'http://localhost:3001') return callback(null, true);

      if (/^https:\/\/.*\.vercel\.app$/.test(origin)) return callback(null, true);
      if (/^https?:\/\/.*\.revopos\.net$/.test(origin)) return callback(null, true);
      if (origin === 'https://revopos.net') return callback(null, true);
      if (origin === 'https://shamounco.org') return callback(null, true);
      if (origin === 'https://alishamoun.com') return callback(null, true);
      if (origin === 'https://www.alishamoun.com') return callback(null, true);

      if (/^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return callback(null, true);
      if (/^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return callback(null, true);
      if (/^https?:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return callback(null, true);
      if (/^https?:\/\/26\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return callback(null, true);

      return callback(new Error(`CORS blocked origin: ${origin}`), false);
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = Number(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`API listening on http://0.0.0.0:${port}`);
  console.log(`Allowed frontend origin(s): ${clientOrigin} (+ LAN regex)`);
  console.log(`Static files served from: ${join(__dirname, '..', 'uploads')}`);
}
bootstrap();