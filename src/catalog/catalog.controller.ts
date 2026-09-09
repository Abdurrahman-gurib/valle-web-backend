import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import {
  ActivityDto,
  CatalogDto,
  RestaurantDto,
} from './catalog.types';

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('catalog')
  @ApiOperation({
    summary: 'Full site catalog (exact shape of Database/seed/data.json)',
  })
  getCatalog(): Promise<CatalogDto> {
    return this.catalogService.getCatalog();
  }

  @Get('experiences')
  @ApiOperation({ summary: 'All experiences (ACTS), ordered by sort_order' })
  getExperiences(): Promise<ActivityDto[]> {
    return this.catalogService.getExperiences();
  }

  @Get('experiences/:id')
  @ApiOperation({ summary: 'Single experience by id' })
  @ApiParam({ name: 'id', example: 'zipline' })
  getExperience(@Param('id') id: string): Promise<ActivityDto> {
    return this.catalogService.getExperience(id);
  }

  @Get('restaurants')
  @ApiOperation({ summary: 'All restaurants keyed by id (RESTOS)' })
  getRestaurants(): Promise<Record<string, RestaurantDto>> {
    return this.catalogService.getRestaurants();
  }

  @Get('restaurants/:id')
  @ApiOperation({ summary: 'Single restaurant by id' })
  @ApiParam({ name: 'id', example: 'chamouze' })
  getRestaurant(@Param('id') id: string): Promise<RestaurantDto> {
    return this.catalogService.getRestaurant(id);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Raw settings key/value map' })
  getSettings(): Promise<Record<string, string>> {
    return this.catalogService.getSettings();
  }
}
