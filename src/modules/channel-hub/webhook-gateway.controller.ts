import {
  Controller,
  Post,
  Get,
  Param,
  Req,
  Res,
  Query,
  Logger,
  HttpCode,
  RawBodyRequest,
  UseGuards,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { Channel, ChannelType, ErrorSeverity, ErrorSource } from '@prisma/client';
import { Request, Response } from 'express';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Public } from '../../common/decorators';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { ChannelsService } from './channels/channels.service';
import { WebhookEventsService } from './webhook-events.service';
import { WebhookThrottleGuard } from './webhook-throttle.guard';
import { MessageTemplatesService } from './message-templates/message-templates.service';
import { AccountUpdateService } from './account-update.service';
import { CoexistenceHistoryService } from './coexistence-history.service';
import { CoexistenceContactsService } from './coexistence-contacts.service';
import { ERROR_CODES } from '../error-reporter/error-codes';
import { ErrorReporterService } from '../error-reporter/error-reporter.service';

@ApiTags('Webhooks')
@Controller('webhooks')
@UseGuards(WebhookThrottleGuard)
export class WebhookGatewayController {
  private readonly logger = new Logger(WebhookGatewayController.name);

  constructor(
    private readonly registry: ChannelAdapterRegistry,
    private readonly channelsService: ChannelsService,
    private readonly webhookEvents: WebhookEventsService,
    @InjectQueue('inbound-messages') private readonly inboundQueue: Queue,
    @Inject(forwardRef(() => MessageTemplatesService))
    private readonly messageTemplatesService: MessageTemplatesService,
    private readonly accountUpdates: AccountUpdateService,
    private readonly coexHistory: CoexistenceHistoryService,
    private readonly coexContacts: CoexistenceContactsService,
    private readonly errors: ErrorReporterService,
  ) {}

  @Post(':channelType')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive webhook from channel provider' })
  @ApiParam({ name: 'channelType', enum: ChannelType })
  async handleWebhook(
    @Param('channelType') channelType: ChannelType,
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ) {
    if (!this.registry.hasAdapter(channelType)) {
      this.logger.warn(`No adapter for channel type: ${channelType}`);
      this.errors.report({
        source: ErrorSource.CHANNEL,
        code: ERROR_CODES.WEBHOOK_UNSUPPORTED_TYPE,
        severity: ErrorSeverity.WARNING,
        message: `Webhook chegou para tipo de canal sem adapter: ${channelType}`,
        context: { channelType },
      });
      return res.status(404).json({ error: 'Unsupported channel type' });
    }

    const adapter = this.registry.getInbound(channelType);
    const headers = req.headers as Record<string, string>;
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));

    // 1. Identify candidate channels from the payload (one payload CAN contain
    //    multiple locators — WA Official batches per businessAccountId).
    const locators = adapter.extractLocators(req.body, headers);
    if (!locators.length) {
      this.logger.warn(`No locators extracted for ${channelType}`);
      this.errors.report({
        source: ErrorSource.CHANNEL,
        code: ERROR_CODES.WEBHOOK_NO_LOCATORS,
        severity: ErrorSeverity.WARNING,
        message: `Nenhum locator extraido do payload de ${channelType}`,
        context: { channelType, payloadKeys: Object.keys(req.body ?? {}) },
      });
      return res.status(200).json({ status: 'no_locators' });
    }

    // 2. Resolve one or more concrete Channel rows.
    const matchedChannels: Channel[] = [];
    // Canais desativados que casaram: reportados uma vez cada, DEPOIS do laço,
    // para um lote com N locators não virar N alertas do mesmo canal.
    const inactiveMatches = new Map<string, Channel>();
    for (const locator of locators) {
      const resolved = await this.channelsService.resolveByLocator(
        channelType,
        (c) => adapter.matchesChannel(c as Channel, locator),
      );
      if (!resolved) {
        this.logger.warn(
          `Webhook arrived for unknown ${channelType} locator: ${JSON.stringify(locator)}`,
        );
        continue;
      }
      if (!resolved.active) {
        // Continua NÃO processando — o que muda é que agora dá para dizer ao
        // dono que o canal existe e só precisa ser reativado.
        inactiveMatches.set(resolved.channel.id, resolved.channel);
        continue;
      }
      if (!matchedChannels.some((m) => m.id === resolved.channel.id)) {
        matchedChannels.push(resolved.channel);
      }
    }

    for (const channel of inactiveMatches.values()) {
      this.logger.warn(
        `Webhook para canal DESATIVADO ${channel.id} (${channelType}) — descartado`,
      );
      this.errors.report({
        source: ErrorSource.CHANNEL,
        code: ERROR_CODES.WEBHOOK_CHANNEL_INACTIVE,
        severity: ErrorSeverity.CRITICAL,
        message: `Canal "${channel.name}" está DESATIVADO e descartou mensagem de cliente — reative o canal`,
        context: { channelType, channelName: channel.name },
        organizationId: channel.organizationId,
        channelId: channel.id,
      });
    }

    if (matchedChannels.length === 0) {
      // Persist for audit even if we can't route — helps debug misconfigured channels.
      await this.webhookEvents
        .recordUnrouted(channelType, req.body, headers)
        .catch((err) =>
          this.logger.error(`webhook_events persist failed: ${err.message}`),
        );
      // CRITICAL: a mensagem do cliente foi DESCARTADA. Foi assim que o
      // apagão do Comercial passou despercebido — canal desativado engolindo
      // inbound em silêncio.
      //
      // Se o motivo do descarte foi canal DESATIVADO, o alerta específico já
      // saiu acima dizendo qual canal reativar. Reportar UNROUTED também
      // mandaria o plantão investigar configuração de um canal que está certo.
      if (inactiveMatches.size === 0) {
        this.errors.report({
          source: ErrorSource.CHANNEL,
          code: ERROR_CODES.WEBHOOK_UNROUTED,
          severity: ErrorSeverity.CRITICAL,
          message: `Webhook de ${channelType} sem canal correspondente — mensagem descartada`,
          context: { channelType, locators },
        });
      }
      return res.status(200).json({ status: 'no_matching_channel' });
    }

    // 3. For each resolved channel: validate signature, parse scoped events, enqueue.
    for (const channel of matchedChannels) {
      const isValid = adapter.validateWebhook(
        headers,
        rawBody,
        channel.webhookSecret || undefined,
        channel,
      );
      if (!isValid) {
        this.logger.warn(
          `Invalid webhook signature for channel ${channel.id} (${channelType})`,
        );
        // CRITICAL: foi exatamente isto que o App Secret errado provocou —
        // TODO webhook recusado, inbound zerado, e nenhum aviso.
        this.errors.report({
          source: ErrorSource.CHANNEL,
          code: ERROR_CODES.WEBHOOK_INVALID_SIGNATURE,
          severity: ErrorSeverity.CRITICAL,
          message: `Assinatura de webhook invalida no canal "${channel.name}" (${channelType})`,
          context: { channelType, channelName: channel.name },
          organizationId: channel.organizationId,
          channelId: channel.id,
        });
        continue;
      }

      // Persist raw payload BEFORE enqueuing (source-of-truth for replay).
      const eventId = await this.webhookEvents
        .record(channel.id, channelType, req.body, headers)
        .catch((err) => {
          this.logger.error(
            `webhook_events persist failed for channel ${channel.id}: ${err.message}`,
          );
          return null;
        });

      const parseResult = adapter.parseWebhook(req.body, channel);

      for (const message of parseResult.messages) {
        await this.inboundQueue.add(
          'process-inbound',
          {
            channelId: channel.id,
            organizationId: channel.organizationId,
            webhookEventId: eventId ?? undefined,
            message,
          },
          {
            attempts: 5,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: true,
            removeOnFail: false,
          },
        );
        this.logger.log(
          `Enqueued inbound: ${message.externalMessageId} → channel ${channel.id} (${channelType})`,
        );
      }

      for (const status of parseResult.statuses) {
        await this.inboundQueue.add(
          'process-status',
          {
            channelId: channel.id,
            organizationId: channel.organizationId,
            status,
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: true,
            removeOnFail: false,
          },
        );
      }

      for (const upd of parseResult.templateStatusUpdates ?? []) {
        await this.messageTemplatesService.applyStatusUpdate(
          upd.metaTemplateId,
          upd.status,
          upd.reason,
        );
        this.logger.log(`Template ${upd.metaTemplateId} → ${upd.status}`);
      }

      for (const sync of parseResult.contactSyncs ?? []) {
        await this.coexContacts
          .handle(channel, sync)
          .catch((err) =>
            this.logger.error(
              `contact sync failed for channel ${channel.id}: ${err.message}`,
            ),
          );
      }

      for (const chunk of parseResult.historyChunks ?? []) {
        await this.coexHistory
          .handleChunk(channel, chunk)
          .catch((err) =>
            this.logger.error(
              `history chunk failed for channel ${channel.id}: ${err.message}`,
            ),
          );
      }

      for (const upd of parseResult.accountUpdates ?? []) {
        await this.accountUpdates
          .handle(channel, upd)
          .catch((err) =>
            this.logger.error(
              `account_update handling failed for channel ${channel.id}: ${err.message}`,
            ),
          );
      }
    }

    return res.status(200).json({ status: 'ok' });
  }

  @Get(':channelType')
  @Public()
  @ApiOperation({ summary: 'Webhook verification (Meta hub.challenge)' })
  @ApiParam({ name: 'channelType', enum: ChannelType })
  async handleVerification(
    @Param('channelType') channelType: ChannelType,
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!this.registry.hasAdapter(channelType)) {
      return res.status(404).json({ error: 'Unsupported channel type' });
    }

    const adapter = this.registry.getInbound(channelType);

    if (!adapter.handleVerification) {
      return res.status(200).json({ status: 'ok' });
    }

    const candidates = await this.channelsService.findActiveByType(channelType);
    // Try each candidate's verifyToken until one matches; the GET verification
    // has no payload to route with, so this is the best we can do.
    for (const channel of candidates) {
      const result = adapter.handleVerification(
        query,
        channel.webhookSecret || undefined,
        channel,
      );
      if (result.statusCode === 200) {
        return res.status(result.statusCode).send(result.body);
      }
    }
    return res.status(403).json({ error: 'Verification failed' });
  }
}
