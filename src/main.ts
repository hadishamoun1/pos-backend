// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';

async function bootstrap() {
  // Let us control CORS explicitly
  const app = await NestFactory.create(AppModule, { cors: false });

  // ✅ Increase JSON/body size limit (fixes: PayloadTooLargeError)
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Frontend origin(s)
  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:3000';


  app.enableCors({
    origin: (origin, callback) => {
      // Allow non-browser clients (Postman, curl) with no Origin header
      if (!origin) return callback(null, true);

      // Allow explicit origin from env (you can set this to your Vercel prod URL)
      if (clientOrigin && origin === clientOrigin) return callback(null, true);

      // Local dev
      if (origin === 'http://localhost:3000') return callback(null, true); // CRA
      if (origin === 'http://localhost:5173') return callback(null, true); // Vite
      if (origin === 'http://localhost:3001') return callback(null, true); // if you use it

      // Allow any Vercel preview/prod domains
      if (/^https:\/\/.*\.vercel\.app$/.test(origin)) return callback(null, true);

      // Optional: allow LAN testing (no fixed port)
      if (/^http:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return callback(null, true);
      if (/^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return callback(null, true);
      if (/^http:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin)) return callback(null, true);

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
}
bootstrap();
