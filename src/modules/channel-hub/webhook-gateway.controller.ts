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
import { Channel, ChannelType } from '@prisma/client';
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
import {
  InboundDropReporter,
  InboundDropReason,
} from './inbound-drop-reporter.service';

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
    private readonly dropReporter: InboundDropReporter,
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
      return res.status(404).json({ error: 'Unsupported channel type' });
    }

    const adapter = this.registry.getInbound(channelType);
    const headers = req.headers as Record<string, string>;
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));

    // 1. Identify candidate channels from the payload (one payload CAN contain
    //    multiple locators — WA Official batches per businessAccountId).
    const locators = adapter.extractLocators(req.body, headers);
    if (!locators.length) {
      await this.dropReporter.reportDrop({
        channelType,
        reason: InboundDropReason.NO_LOCATORS,
        payload: req.body,
        headers,
        channel: null,
      });
      return res.status(200).json({ status: 'no_locators' });
    }

    // 2. Resolve one or more concrete Channel rows.
    const matchedChannels: Channel[] = [];
    // Um payload em lote (WA Official) pode trazer N locators ruins. Agrupamos
    // por motivo+canal para não escrever N linhas de auditoria com o payload
    // inteiro repetido — o contador preserva o diagnóstico.
    const drops = new Map<
      string,
      { reason: InboundDropReason; channel: Channel | null; count: number; fields: Set<string> }
    >();

    const noteDrop = (
      reason: InboundDropReason,
      channel: Channel | null,
      locator: unknown,
    ) => {
      const key = `${reason}:${channel?.id ?? 'none'}`;
      const entry = drops.get(key) ?? { reason, channel, count: 0, fields: new Set<string>() };
      entry.count += 1;
      // só os NOMES dos campos do locator — os valores podem ser tokens
      for (const f of Object.keys((locator ?? {}) as object)) entry.fields.add(f);
      drops.set(key, entry);
    };

    for (const locator of locators) {
      const resolved = await this.channelsService.resolveByLocator(
        channelType,
        (c) => adapter.matchesChannel(c as Channel, locator),
      );

      if (!resolved) {
        noteDrop(InboundDropReason.UNKNOWN_LOCATOR, null, locator);
        continue;
      }

      if (!resolved.active) {
        // Canal existe mas está desativado: continua NÃO processando — só que
        // agora o dono fica sabendo, em vez da mensagem sumir.
        noteDrop(InboundDropReason.CHANNEL_INACTIVE, resolved.channel, locator);
        continue;
      }

      if (!matchedChannels.some((m) => m.id === resolved.channel.id)) {
        matchedChannels.push(resolved.channel);
      }
    }

    for (const entry of drops.values()) {
      await this.dropReporter.reportDrop({
        channelType,
        reason: entry.reason,
        payload: req.body,
        headers,
        channel: entry.channel,
        detail: `${entry.count}x, campos do locator: ${[...entry.fields].sort().join('+') || 'nenhum'}`,
      });
    }

    if (matchedChannels.length === 0) {
      // Cada motivo já foi relatado uma vez acima — relatar de novo aqui
      // duplicaria toda linha de auditoria.
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
        await this.dropReporter.reportDrop({
          channelType,
          reason: InboundDropReason.INVALID_SIGNATURE,
          payload: req.body,
          headers,
          channel,
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
