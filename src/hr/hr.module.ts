import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobApplication, JobVacancy } from '../entities';
import { RolesGuard } from '../staff/auth/roles.guard';
import { StaffAuthModule } from '../staff/auth/staff-auth.module';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';

/**
 * The careers back office. StaffAuthModule supplies the same session check the
 * rest of the back office uses; RolesGuard narrows it to hr and manager.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([JobVacancy, JobApplication]),
    StaffAuthModule,
  ],
  controllers: [HrController],
  providers: [HrService, RolesGuard],
})
export class HrModule {}
