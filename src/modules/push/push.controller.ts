import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser } from '../../common/decorators';
import { PushSubscriptionDto } from './dto/push-subscription.dto';
import { isKnownPushService } from './push-endpoints';
import { PushSenderService } from './push-sender.service';
import { PushSubscriptionsService } from './push-subscriptions.service';

@ApiTags('Push')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard)
@Controller('push')
export class PushController {
  constructor(
    private readonly sender: PushSenderService,
    private readonly subscriptions: PushSubscriptionsService,
  ) {}

  @Get('config')
  @ApiOperation({ summary: 'Chave pública VAPID (null = push desligado no servidor)' })
  config() {
    return { enabled: this.sender.isEnabled(), publicKey: this.sender.publicKey() };
  }

  @Put('subscriptions')
  @HttpCode(204)
  @ApiOperation({ summary: 'Grava/renova a inscrição de push deste navegador' })
  async subscribe(
    @CurrentUser('id') userId: string,
    @CurrentOrg('id') orgId: string,
    @Body() dto: PushSubscriptionDto,
  ): Promise<void> {
    if (!isKnownPushService(dto.endpoint)) {
      throw new BadRequestException('Serviço de push não reconhecido');
    }
    await this.subscriptions.upsert({
      userId,
      organizationId: orgId,
      endpoint: dto.endpoint,
      p256dhKey: dto.keys.p256dh,
      authKey: dto.keys.auth,
      userAgent: dto.userAgent ?? null,
    });
  }

  @Delete('subscriptions')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a inscrição deste navegador (logout ou desligar)' })
  @ApiQuery({ name: 'endpoint', required: true })
  async unsubscribe(@CurrentUser('id') userId: string, @Query('endpoint') endpoint?: string): Promise<void> {
    if (!endpoint) throw new BadRequestException('endpoint obrigatório');
    await this.subscriptions.removeForUser(userId, endpoint);
  }
}
