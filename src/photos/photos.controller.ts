import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { IsSafeText } from '../common/validation';
import { BookingPhoto } from '../entities/booking-photo.entity';
import { GuestMessagingService } from '../notifications/guest-messaging.service';
import { CurrentStaff } from '../staff/auth/current-staff.decorator';
import { Roles, RolesGuard } from '../staff/auth/roles.guard';
import { StaffAuthGuard } from '../staff/auth/staff-auth.guard';
import type { StaffPrincipal } from '../staff/auth/staff-auth.types';
import { TicketQueryDto } from '../tickets/ticket.dto';
import { PHOTO_MAX_BYTES, PhotoSet, PhotosService, UploadedPhotoFile } from './photos.service';

export class PhotoCaptionDto {
  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional() @IsString() @IsSafeText() @MaxLength(160)
  caption?: string;
}

/** One file per request, held in memory (it goes straight into Postgres), capped. */
const upload = () => FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: PHOTO_MAX_BYTES, files: 1 } });

function sendPhoto(res: Response, p: BookingPhoto, download: boolean): void {
  res.setHeader('Content-Type', p.mime);
  res.setHeader('Content-Length', String(p.data.length));
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(p.name)}`);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(p.data);
}

class PhotoFileQueryDto extends TicketQueryDto {
  @ApiPropertyOptional({ description: '1 to download as a file instead of displaying inline' })
  @IsOptional() @IsString()
  download?: string;
}

@ApiTags('tickets')
@Controller('tickets')
export class GuestPhotosController {
  constructor(private readonly photos: PhotosService) {}

  @Get(':refCode/photos')
  @ApiOperation({ summary: 'The visit photos of a booking (ticket token)' })
  @Header('Cache-Control', 'private, no-store')
  list(@Param('refCode') refCode: string, @Query() q: TicketQueryDto): Promise<PhotoSet> {
    return this.photos.set(refCode.toUpperCase(), q.t);
  }

  @Get(':refCode/photos/:id')
  @ApiOperation({ summary: 'One visit photo (ticket token); ?download=1 saves it as a file' })
  @ApiResponse({ status: 403, description: 'Bad ticket token' })
  async file(@Param('refCode') refCode: string, @Param('id', ParseUUIDPipe) id: string, @Query() q: PhotoFileQueryDto, @Res() res: Response): Promise<void> {
    const p = await this.photos.file(refCode.toUpperCase(), id, q.t);
    sendPhoto(res, p, q.download === '1');
  }
}

@ApiTags('staff-bookings')
@Controller('staff/bookings')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('agent', 'manager')
export class StaffPhotosController {
  constructor(private readonly photos: PhotosService, private readonly messaging: GuestMessagingService) {}

  @Get(':refCode/photos')
  @Header('Cache-Control', 'no-store')
  list(@Param('refCode') refCode: string): Promise<PhotoSet> {
    return this.photos.set(refCode);
  }

  @Post(':refCode/photos')
  @UseInterceptors(upload())
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload one visit photo for a booking (multipart: file, caption)' })
  @ApiResponse({ status: 400, description: 'Missing, too large or unsupported file' })
  add(@Param('refCode') refCode: string, @Body() dto: PhotoCaptionDto, @UploadedFile() file: UploadedPhotoFile | undefined, @CurrentStaff() staff: StaffPrincipal): Promise<PhotoSet> {
    return this.photos.add(refCode, file, dto.caption ?? '', staff.email);
  }

  @Get(':refCode/photos/:id')
  async file(@Param('refCode') refCode: string, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    sendPhoto(res, await this.photos.file(refCode, id), false);
  }

  @Delete(':refCode/photos/:id')
  remove(@Param('refCode') refCode: string, @Param('id', ParseUUIDPipe) id: string): Promise<PhotoSet> {
    return this.photos.remove(refCode, id);
  }

  @Post(':refCode/photos/ready')
  @ApiOperation({ summary: 'Tell the guest their photos are on the ticket page (e-mail, WhatsApp when allowed)' })
  @ApiResponse({ status: 409, description: 'No photos uploaded yet' })
  async ready(@Param('refCode') refCode: string): Promise<{ email: boolean; whatsapp: boolean; photosReadyAt: string }> {
    const b = await this.photos.markReady(refCode);
    const sent = await this.messaging.sendPhotosReady(b, (await this.photos.set(refCode)).count);
    return { ...sent, photosReadyAt: b.photosReadyAt!.toISOString() };
  }
}
