import { Module } from '@nestjs/common';
import { StaffAuthModule } from '../auth/staff-auth.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [StaffAuthModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
