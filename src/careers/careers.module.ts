import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobApplication, JobVacancy } from '../entities';
import { CareersController } from './careers.controller';
import { CareersService } from './careers.service';

/**
 * Public careers pages. Unguarded by design, which is why it is a separate
 * module from `HrModule`: the two surfaces read the same tables but must never
 * share a code path that could return an internal column.
 */
@Module({
  imports: [TypeOrmModule.forFeature([JobVacancy, JobApplication])],
  controllers: [CareersController],
  providers: [CareersService],
})
export class CareersModule {}
