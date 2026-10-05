import { Module } from '@nestjs/common';
import { StaffAuthModule } from '../staff/auth/staff-auth.module';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';

/** Operational visibility for managers: the backup log written by scripts/db-backup.js. */
@Module({
  imports: [StaffAuthModule],
  controllers: [OpsController],
  providers: [OpsService],
})
export class OpsModule {}
