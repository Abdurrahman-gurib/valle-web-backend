import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Coupon } from '../entities';
import { StaffAuthModule } from '../staff/auth/staff-auth.module';
import { CouponsController, StaffCouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';

/** Promo codes, FOC passes and partner discounts as codes; checked on the website, applied to bookings. */
@Module({
  imports: [TypeOrmModule.forFeature([Coupon]), StaffAuthModule],
  controllers: [CouponsController, StaffCouponsController],
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
