import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { corsOrigins } from './config/cors';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  // Validate first: a bad production config should never reach the point of
  // accepting a request.
  const env = loadEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Stack traces and Nest's verbose logs are useful locally and are noise (or
    // a disclosure risk) in production.
    logger: env.isProduction
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug', 'verbose'],
  });
  const config = app.get(ConfigService);

  // Railway's edge, Azure Front Door and the nginx container in front of this
  // API all terminate TLS upstream. Without this the rate limiters would see
  // the proxy's IP for every caller and `secure` cookies would be dropped.
  if (env.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      // The SPA is served by nginx, not this API, so the only documents this
      // origin serves are Swagger (dev only) and JSON. Lock the rest down.
      contentSecurityPolicy: env.isProduction
        ? {
            directives: {
              defaultSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'none'"],
              formAction: ["'none'"],
            },
          }
        : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: env.isProduction
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
    }),
  );

  // Never advertise the framework.
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  // StaffAuthGuard reads the httpOnly session cookie off `req.cookies`.
  app.use(cookieParser());

  app.enableCors({
    origin: corsOrigins(config.get<string>('CORS_ORIGIN')),
    // Required so the staff session cookie is sent and set through the dev proxy.
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Reject unknown keys outright rather than silently dropping them, so a
      // client cannot probe for fields the API does not intend to accept.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      // Validation messages describe the caller's own payload, never internals.
      disableErrorMessages: false,
    }),
  );

  // Swagger describes every route and DTO, so it stays off in production.
  const docsEnabled = !env.isProduction;
  if (docsEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('VALLÉ Advenature Park API')
      .setDescription(
        'Catalog, bookings, careers and back-office API for VALLÉ Advenature™ Park.',
      )
      .setVersion('1.0')
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  // Orchestrators send SIGTERM before recycling an instance; finish in-flight requests.
  app.enableShutdownHooks();

  // Dual-stack bind. Railway's private network (how nginx reaches this API)
  // and its healthcheck speak IPv6; docker compose and local tools speak IPv4.
  // '::' accepts both on Linux, whereas '0.0.0.0' would leave the API
  // unreachable from nginx on Railway.
  await app.listen(env.port, '::');
  // eslint-disable-next-line no-console
  console.log(`VALLE Advenature Park API listening on port ${env.port} (${env.nodeEnv})`);
  if (docsEnabled) {
    // eslint-disable-next-line no-console
    console.log(`Swagger docs on http://localhost:${env.port}/api/docs`);
  }
}

void bootstrap();
