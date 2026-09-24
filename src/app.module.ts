import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingsModule } from './bookings/bookings.module';
import { CareersModule } from './careers/careers.module';
import { CatalogModule } from './catalog/catalog.module';
import { ChatModule } from './chat/chat.module';
import { dbSslOptions } from './config/db';
import { HealthModule } from './health/health.module';
import { HrModule } from './hr/hr.module';
import { QuotesModule } from './quotes/quotes.module';
import { StaffAuthModule } from './staff/auth/staff-auth.module';
import { StaffBookingsModule } from './staff/bookings/staff-bookings.module';

@Module({
  imports: [
    // Sentry first so its filter and tracing wrap every other module's handlers.
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DB_HOST', 'localhost'),
        port: parseInt(config.get<string>('DB_PORT', '5433'), 10),
        username: config.get<string>('DB_USER', 'postgres'),
        password: config.get<string>('DB_PASSWORD', 'postgres'),
        database: config.get<string>('DB_NAME', 'valle_park'),
        // TLS mode from DB_SSL (see config/db.ts). Production refuses plain TCP
        // at boot (env.ts), so a deployment can never leak the password in clear.
        ssl: dbSslOptions(config.get<string>('DB_SSL')),
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    // Generous global ceiling: a safety net against abuse, never something the
    // public site should hit. The strict 5/60 s login budget is applied per-route
    // in StaffAuthController, and no global ThrottlerGuard is registered here.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    CatalogModule,
    BookingsModule,
    QuotesModule,
    HealthModule,
    StaffAuthModule,
    StaffBookingsModule,
    ChatModule,
    // Public careers pages and the HR back office read the same two tables
    // through separate modules, so a public route can never reach an
    // HR-only code path.
    CareersModule,
    HrModule,
  ],
  providers: [
    // Reports unhandled (5xx) exceptions to Sentry; expected HttpExceptions are not noise.
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
  ],
})
export class AppModule {}
