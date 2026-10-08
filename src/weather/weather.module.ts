import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Experience, Setting } from '../entities';
import { StaffAuthModule } from '../staff/auth/staff-auth.module';
import { LiveOpsService } from './live-ops.service';
import { ParkStatusService } from './park-status.service';
import { StaffParkStatusController, WeatherController } from './weather.controller';
import { WeatherService } from './weather.service';

/** Live weather (Open-Meteo) and the desk-set park status. */
@Module({
  imports: [TypeOrmModule.forFeature([Setting, Experience]), StaffAuthModule],
  controllers: [WeatherController, StaffParkStatusController],
  providers: [WeatherService, ParkStatusService, LiveOpsService],
  exports: [ParkStatusService, WeatherService, LiveOpsService],
})
export class WeatherModule {}
