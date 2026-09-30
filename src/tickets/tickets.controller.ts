import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { TicketQueryDto } from './ticket.dto';
import { TicketService, TicketView } from './ticket.service';

@ApiTags('tickets')
@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketService) {}

  @Get(':refCode')
  @ApiOperation({ summary: "A guest's ticket (needs the token from the e-mail / QR link)" })
  @ApiResponse({ status: 403, description: 'Bad or missing token' })
  @Header('Cache-Control', 'private, no-store')
  view(@Param('refCode') refCode: string, @Query() q: TicketQueryDto): Promise<TicketView> {
    return this.tickets.view(refCode.toUpperCase(), q.t);
  }

  @Get(':refCode/receipt.pdf')
  @ApiOperation({ summary: "The guest's receipt as PDF (needs the token)" })
  async receipt(@Param('refCode') refCode: string, @Query() q: TicketQueryDto, @Res() res: Response): Promise<void> {
    const pdf = await this.tickets.receiptPdf(refCode.toUpperCase(), q.t);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="valle-receipt-${refCode.toUpperCase()}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }

  @Get(':refCode/qr.png')
  @ApiOperation({ summary: 'QR code of the ticket link, as PNG' })
  async qr(@Param('refCode') refCode: string, @Query() q: TicketQueryDto, @Res() res: Response): Promise<void> {
    const ref = refCode.toUpperCase();
    await this.tickets.requireBooking(ref, q.t);
    const png = await this.tickets.qrPng(ref);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(png);
  }
}
