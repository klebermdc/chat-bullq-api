import { Injectable, Logger } from '@nestjs/common';
import type { MessageContentType, MessageDirection, MessageStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { computeWhatsappWindow } from '../../messaging/conversations/whatsapp-window.util';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { DEFAULT_TIMEZONE, resolveHours, toHoursConfig } from '../../response-sla/response-sla.rules';
import { isWithinHours } from '../../routing/availability/business-hours.util';
import { CallingGraphClient } from './calling-graph.client';
import { LiveKitDialer } from './livekit-dialer';
import {
  CALL_GRACE_HOURS,
  decideCall,
  decidePermissionRequest,
  parseVoiceCallSettings,
  PERMISSION_REQUEST_MAX_AGE_MIN,
  type VoiceCallSettings,
} from './outreach.rules';

const OUTBOUND: MessageDirection = 'OUTBOUND';
const SYSTEM: MessageContentType = 'SYSTEM';
const SENT: MessageStatus = 'SENT';
const OFFICIAL = 'WHATSAPP_OFFICIAL';
const HOUR = 3600_000;
const BATCH = 50;

export const PERMISSION_TEXT =
  'Posso te ligar por aqui pelo WhatsApp para tirar dúvidas da sua cotação? É rapidinho e você escolhe se quer receber a ligação.';

/** Primeiro nome "falável" (a missão higieniza de novo). */
export function firstName(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return /\p{L}/u.test(first) ? first.slice(0, 40) : null;
}

/** Contato pediu para não receber ligação da Aline. */
export function isOptedOut(metadata: unknown): boolean {
  return !!metadata && typeof metadata === 'object' && (metadata as Record<string, unknown>).voiceCallsOptOut === true;
}

const CONVERSATION_SELECT = {
  id: true,
  channelId: true,
  contactId: true,
  assignedToId: true,
  lastInboundAt: true,
  metaWindowExpiresAt: true,
  channel: { select: { type: true, config: true } },
  contact: { select: { name: true, phone: true, ctwaClidAt: true, metadata: true } },
  assignedTo: { select: { name: true } },
} as const;

/**
 * Ligação de retorno de cotação (F6). Roda pela varredura periódica e SÓ para
 * agências com `settings.voiceCalls.enabled === true` (desligado por padrão).
 */
@Injectable()
export class OutreachService {
  private readonly logger = new Logger(OutreachService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: CallingGraphClient,
    private readonly dialer: LiveKitDialer,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Agências com a chave ligada. */
  async enabledOrganizations(): Promise<{ id: string; settings: VoiceCallSettings; tz: string; hours: unknown }[]> {
    const orgs = await this.prisma.organization.findMany({
      where: { deletedAt: null },
      select: { id: true, settings: true, aiTimezone: true, aiBusinessHours: true },
    });
    return orgs
      .map((o) => ({ id: o.id, settings: parseVoiceCallSettings(o.settings), tz: o.aiTimezone || DEFAULT_TIMEZONE, hours: o.aiBusinessHours }))
      .filter((o) => o.settings.enabled);
  }

  async sweep(now = new Date()): Promise<void> {
    for (const org of await this.enabledOrganizations()) {
      try {
        await this.requestPermissions(org.id, now);
        await this.callDue(org, now);
      } catch (err) {
        this.logger.error(`varredura de ligações da org ${org.id} falhou: ${(err as Error).message}`);
      }
    }
  }

  /** Passo 1: logo depois da cotação, pede permissão de ligação (janela aberta). */
  async requestPermissions(organizationId: string, now: Date): Promise<void> {
    const proposals = await this.prisma.proposal.findMany({
      where: {
        organizationId,
        createdAt: { gte: new Date(now.getTime() - PERMISSION_REQUEST_MAX_AGE_MIN * 60_000) },
        voiceOutreach: null,
      },
      select: { id: true, conversationId: true, contactId: true, createdAt: true },
      take: BATCH,
    });
    for (const p of proposals) {
      const conv = await this.prisma.conversation.findFirst({ where: { id: p.conversationId, organizationId }, select: CONVERSATION_SELECT });
      const row = { organizationId, proposalId: p.id, conversationId: p.conversationId, contactId: p.contactId };
      if (!conv || conv.channel?.type !== OFFICIAL || !conv.contact?.phone) {
        await this.prisma.voiceOutreach.create({ data: { ...row, permissionStatus: 'PULADA', permissionNote: 'CANAL_SEM_LIGACAO' } });
        continue;
      }
      const window = computeWhatsappWindow({
        channelType: conv.channel.type,
        lastInboundAt: conv.lastInboundAt ?? null,
        ctwaClidAt: conv.contact.ctwaClidAt ?? null,
        metaWindowExpiresAt: conv.metaWindowExpiresAt ?? null,
        now,
      });
      const decision = decidePermissionRequest({
        now,
        proposalCreatedAt: p.createdAt,
        windowOpen: window.open,
        alreadyRequested: false,
        optedOut: isOptedOut(conv.contact.metadata),
      });
      if (decision.action === 'PULAR') {
        await this.prisma.voiceOutreach.create({ data: { ...row, permissionStatus: 'PULADA', permissionNote: decision.reason } });
        continue;
      }
      try {
        const state = await this.graph.getPermission(conv.channel, conv.contact.phone);
        if (state.canCall) {
          await this.prisma.voiceOutreach.create({ data: { ...row, permissionStatus: 'PULADA', permissionNote: 'JA_TEM_PERMISSAO' } });
          continue;
        }
        if (!state.canRequest) {
          await this.prisma.voiceOutreach.create({ data: { ...row, permissionStatus: 'PULADA', permissionNote: 'LIMITE_DA_META' } });
          continue;
        }
        await this.graph.requestPermission(conv.channel, conv.contact.phone, PERMISSION_TEXT);
        await this.prisma.voiceOutreach.create({ data: { ...row, permissionStatus: 'PEDIDA', permissionRequestedAt: now } });
        await this.systemNote(conv, '📞 Pedido de permissão de ligação enviado ao cliente (Aline pode ligar sobre a cotação).');
      } catch (err) {
        await this.prisma.voiceOutreach.create({ data: { ...row, permissionStatus: 'FALHOU', permissionNote: (err as Error).message.slice(0, 300) } });
      }
    }
  }

  /** Passo 2: X horas depois da cotação sem resposta, confere a permissão e liga. */
  async callDue(org: { id: string; settings: VoiceCallSettings; tz: string; hours: unknown }, now: Date): Promise<void> {
    const { delayHours } = org.settings;
    const proposals = await this.prisma.proposal.findMany({
      where: {
        organizationId: org.id,
        createdAt: {
          lte: new Date(now.getTime() - delayHours * HOUR),
          gte: new Date(now.getTime() - (delayHours + CALL_GRACE_HOURS) * HOUR),
        },
        OR: [{ voiceOutreach: null }, { voiceOutreach: { callStatus: null } }],
      },
      select: { id: true, conversationId: true, contactId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    });
    for (const p of proposals) {
      const conv = await this.prisma.conversation.findFirst({ where: { id: p.conversationId, organizationId: org.id }, select: CONVERSATION_SELECT });
      if (!conv || conv.channel?.type !== OFFICIAL || !conv.contact?.phone) {
        await this.markCall(org.id, p, 'PULADA', 'CANAL_SEM_LIGACAO');
        continue;
      }
      const ownerHours = conv.assignedToId
        ? await this.prisma.userOrganization.findFirst({ where: { organizationId: org.id, userId: conv.assignedToId }, select: { workingHours: true } })
        : null;
      const hours = resolveHours(toHoursConfig(ownerHours?.workingHours ?? null), toHoursConfig(org.hours));
      const decision = decideCall({
        now,
        delayHours,
        proposalCreatedAt: p.createdAt,
        lastInboundAt: conv.lastInboundAt ?? null,
        hasOwner: !!conv.assignedToId,
        withinHours: isWithinHours(hours, org.tz, now),
        optedOut: isOptedOut(conv.contact.metadata),
        alreadyCalled: false,
      });
      if (decision.action === 'ESPERAR') continue;
      if (decision.action === 'PULAR') {
        await this.markCall(org.id, p, 'PULADA', decision.reason);
        continue;
      }
      await this.dialOnce(org.id, p, conv, now);
    }
  }

  private async dialOnce(
    organizationId: string,
    p: { id: string; conversationId: string; contactId: string },
    conv: { id: string; channelId: string; contactId: string; channel: { config: unknown } | null; contact: { name: string | null; phone: string | null } | null; assignedTo: { name: string } | null },
    now: Date,
  ): Promise<void> {
    // Trava contra discar duas vezes: só segue quem conseguir marcar LIGANDO.
    await this.prisma.voiceOutreach.upsert({
      where: { proposalId: p.id },
      create: { organizationId, proposalId: p.id, conversationId: p.conversationId, contactId: p.contactId },
      update: {},
    });
    const claimed = await this.prisma.voiceOutreach.updateMany({ where: { proposalId: p.id, callStatus: null }, data: { callStatus: 'LIGANDO' } });
    if (claimed.count === 0) return;
    try {
      if (!this.dialer.configured) throw new Error('LIVEKIT_NAO_CONFIGURADO');
      const state = await this.graph.getPermission(conv.channel!, conv.contact!.phone!);
      if (!state.canCall) {
        await this.prisma.voiceOutreach.update({ where: { proposalId: p.id }, data: { callStatus: 'SEM_PERMISSAO', callNote: state.status } });
        return;
      }
      const room = `retorno-${p.id}`;
      const mission = JSON.stringify({
        missao: 'retorno_cotacao',
        cliente: firstName(conv.contact!.name) ?? 'cliente',
        vendedor: firstName(conv.assignedTo?.name) ?? 'seu consultor',
        conversationId: conv.id,
      });
      const usedRoom = await this.dialer.dial({ room, phoneE164: `+${conv.contact!.phone!.replace(/\D/g, '')}`, missionMetadata: mission, contactName: conv.contact!.name ?? 'Cliente' });
      await this.prisma.voiceOutreach.update({ where: { proposalId: p.id }, data: { callStatus: 'LIGOU', calledAt: now, room: usedRoom } });
      await this.systemNote(conv, '📞 A Aline ligou para o cliente para confirmar se ele viu a cotação.');
    } catch (err) {
      await this.prisma.voiceOutreach.update({ where: { proposalId: p.id }, data: { callStatus: 'FALHOU', callNote: (err as Error).message.slice(0, 300) } });
    }
  }

  private async markCall(organizationId: string, p: { id: string; conversationId: string; contactId: string }, status: string, note: string) {
    await this.prisma.voiceOutreach.upsert({
      where: { proposalId: p.id },
      create: { organizationId, proposalId: p.id, conversationId: p.conversationId, contactId: p.contactId, callStatus: status, callNote: note },
      update: { callStatus: status, callNote: note },
    });
  }

  private async systemNote(conv: { id: string; channelId: string; contactId: string }, text: string) {
    const message = await this.prisma.message.create({
      data: { conversationId: conv.id, direction: OUTBOUND, type: SYSTEM, status: SENT, sentAt: new Date(), content: { text }, metadata: { source: 'voice-outreach' } },
    });
    this.realtime.emitToChannel(conv.channelId, 'message:new', { message, conversationId: conv.id, contactId: conv.contactId });
    this.realtime.emitToConversation(conv.id, 'message:new', { message });
  }
}
