import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Experience, Setting } from '../entities';
import { StaffAuthModule } from '../staff/auth/staff-auth.module';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';
import { RetentionService } from './retention.service';

/** Operational visibility for managers: the backup log written by scripts/db-backup.js, and the daily data-retention job. */
@Module({
  imports: [StaffAuthModule, TypeOrmModule.forFeature([Setting, Experience])],
  controllers: [OpsController],
  providers: [OpsService, RetentionService],
})
export class OpsModule {}
