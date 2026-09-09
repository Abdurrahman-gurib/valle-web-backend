import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { QuotesService } from './quotes.service';

/**
 * Quote requests: 5 per 10 minutes per IP. A quote is a considered, one-per-
 * visit action (one form, one group, one event), so even an organiser who
 * resubmits after fixing a typo or asks about two separate events in one
 * sitting stays well inside five. The same budget as a careers application,
 * for the same reason: both land in a human inbox that nobody can un-flood.
 */
const QUOTE_LIMIT = 5;
const QUOTE_TTL_MS = 600_000;

@ApiTags('quotes')
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Post()
  // Public write: capped per IP so the sales inbox cannot be flooded.
  // Route-scoped, so nothing else on this surface is metered.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: QUOTE_LIMIT, ttl: QUOTE_TTL_MS } })
  @ApiOperation({ summary: 'Submit a group / team-building quote request' })
  @ApiResponse({ status: 201, description: 'Quote stored, returns its id' })
  @ApiResponse({ status: 429, description: 'Too many quote requests (5 / 10 min)' })
  create(@Body() dto: CreateQuoteDto): Promise<{ id: string }> {
    return this.quotesService.create(dto);
  }
}
