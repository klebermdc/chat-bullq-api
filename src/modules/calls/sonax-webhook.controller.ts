import { Controller, Get, Post, Param, Query, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { SonaxWebhookService, SonaxWebhookQuery } from './sonax-webhook.service';

@ApiTags('Webhooks')
@Controller('webhooks/sonax')
export class SonaxWebhookController {
  constructor(private readonly service: SonaxWebhookService) {}

  @Get(':secret')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Recebe o webhook de desligamento da Sonax (GET com placeholders)' })
  handleGet(@Param('secret') secret: string, @Query() q: SonaxWebhookQuery) {
    return this.service.apply(secret, q);
  }

  @Post(':secret')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Recebe o webhook de desligamento da Sonax (POST)' })
  handlePost(@Param('secret') secret: string, @Query() q: SonaxWebhookQuery) {
    return this.service.apply(secret, q);
  }
}
