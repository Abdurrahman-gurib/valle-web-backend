import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  CareersService,
  VacancyCard,
  VacancyDetail,
} from './careers.service';
import { ApplyToVacancyDto, VacancySlugParamDto } from './dto/careers.dto';

/** Applications: 5 per 10 minutes per IP. */
const APPLY_LIMIT = 5;
const APPLY_TTL_MS = 600_000;

/**
 * The public careers API. No auth, so the rules are simple and absolute:
 * published rows only, and no applicant data or internal note in any response.
 */
@ApiTags('careers')
@Controller('vacancies')
export class CareersController {
  constructor(private readonly careers: CareersService) {}

  @Get()
  @ApiOperation({ summary: 'Open roles, newest first' })
  async list(): Promise<{ items: VacancyCard[] }> {
    return { items: await this.careers.listPublished() };
  }

  @Get(':slug')
  @ApiOperation({ summary: 'One open role' })
  @ApiResponse({ status: 404, description: 'Unknown, drafted or closed role' })
  detail(@Param() params: VacancySlugParamDto): Promise<VacancyDetail> {
    return this.careers.findPublished(params.slug);
  }

  @Post(':slug/apply')
  // The only public write on this surface: capped per IP so the HR inbox
  // cannot be flooded. Route-scoped, so reading the listings stays unmetered.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: APPLY_LIMIT, ttl: APPLY_TTL_MS } })
  @ApiOperation({ summary: 'Apply for an open role' })
  @ApiResponse({ status: 404, description: 'Unknown, drafted or closed role' })
  @ApiResponse({ status: 429, description: 'Too many applications (5 / 10 min)' })
  apply(
    @Param() params: VacancySlugParamDto,
    @Body() dto: ApplyToVacancyDto,
  ): Promise<{ id: string }> {
    return this.careers.apply(params.slug, dto);
  }
}
