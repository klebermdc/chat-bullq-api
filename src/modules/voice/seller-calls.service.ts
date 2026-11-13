import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrgRole, type MessageContentType, type MessageDirection, type MessageStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { computeWhatsappWindow } from '../messaging/conversations/whatsapp-window.util';
import { SimulatedRecipients } from '../mystery-shopper/simulated/simulated-recipients.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CallingGraphClient } from './outreach/calling-graph.client';
import { LiveKitDialer } from './outreach/livekit-dialer';
import { PERMISSION_TEXT } from './outreach/outreach.service';
import { SellerCallRecordService } from './seller-call-record.service';

const OUTBOUND: MessageDirection = 'OUTBOUND';
const SYSTEM: MessageContentType = 'SYSTEM';
const SENT: MessageStatus = 'SENT';
const OFFICIAL = 'WHATSAPP_OFFICIAL';

/** Chave "Vendedores ligam pelo WhatsApp" — DESLIGADA por padrão. */
export function parseSellerCallSettings(settings: unknown): { enabled: boolean } {
  const raw =
    settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>).sellerCalls : undefined;
  return { enabled: !!raw && typeof raw === 'object' && (raw as Record<string, unknown>).enabled === true };
}

/** Liga: o vendedor dono da conversa e a gestão. */
export function canSellerCall(viewer: { userId: string; role?: OrgRole }, assignedToId: string | null): boolean {
  return viewer.role === OrgRole.OWNER || viewer.role === OrgRole.ADMIN || (!!assignedToId && assignedToId === viewer.userId);
}

export interface SellerViewer {
  userId: string;
  role?: OrgRole;
  name: string;
}

/** Room do vendedor: só letras/números/hífen (vem da conversa, nunca do navegador). */
export const sellerRoom = (conversationId: string, now = Date.now()) => `vendedor-${conversationId}-${now}`;

@Injectable()
export class SellerCallsService {
  private readonly logger = new Logger(SellerCallsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: CallingGraphClient,
    private readonly dialer: LiveKitDialer,
    private readonly realtime: RealtimeGateway,
    private readonly records: SellerCallRecordService,
    private readonly simulated: SimulatedRecipients,
  ) {}

  private async load(orgId: string, conversationId: string, viewer: SellerViewer) {
    const [org, conv] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } }),
      this.prisma.conversation.findFirst({
        where: { id: conversationId, organizationId: orgId, deletedAt: null },
        select: {
          id: true,
          channelId: true,
          contactId: true,
          assignedToId: true,
          lastInboundAt: true,
          metaWindowExpiresAt: true,
          channel: { select: { type: true, config: true } },
          contact: { select: { name: true, phone: true, ctwaClidAt: true } },
        },
      }),
    ]);
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    if (!parseSellerCallSettings(org?.settings).enabled) throw new ForbiddenException('Ligações de vendedor pelo WhatsApp estão desligadas');
    if (!canSellerCall(viewer, conv.assignedToId)) throw new ForbiddenException('Só o vendedor da conversa ou a gestão podem ligar');
    if (conv.channel?.type !== OFFICIAL || !conv.contact?.phone) throw new BadRequestException('Ligação pelo WhatsApp só no canal oficial');
    return conv;
  }

  /** Estado para o botão: pode ligar? pode pedir permissão? */
  async check(orgId: string, conversationId: string, viewer: SellerViewer) {
    const conv = await this.load(orgId, conversationId, viewer);
    // Simulado: a Meta nunca é consultada; o cliente "nunca concedeu" a permissão.
    const permission = (await this.simulated.isSimulatedContact(conv.contactId))
      ? { canCall: false, canRequest: true, status: 'no_permission' }
      : await this.graph.getPermission(conv.channel!, conv.contact!.phone!);
    const window = computeWhatsappWindow({
      channelType: conv.channel!.type,
      lastInboundAt: conv.lastInboundAt ?? null,
      ctwaClidAt: conv.contact!.ctwaClidAt ?? null,
      metaWindowExpiresAt: conv.metaWindowExpiresAt ?? null,
      now: new Date(),
    });
    return {
      canCall: permission.canCall && this.dialer.configured,
      canRequest: permission.canRequest && window.open,
      permission: permission.status,
      windowOpen: window.open,
      dialerConfigured: this.dialer.configured,
    };
  }

  async requestPermission(orgId: string, conversationId: string, viewer: SellerViewer) {
    const state = await this.check(orgId, conversationId, viewer);
    if (!state.canRequest) {
      throw new BadRequestException(state.windowOpen ? 'A Meta não permite novo pedido agora (limite de 1 por dia)' : 'Janela de 24h fechada: o cliente precisa mandar mensagem antes');
    }
    const conv = await this.load(orgId, conversationId, viewer);
    // Simulado: só a nota de sistema; nada é enviado à Meta.
    if (!(await this.simulated.isSimulatedContact(conv.contactId))) {
      await this.graph.requestPermission(conv.channel!, conv.contact!.phone!, PERMISSION_TEXT);
    }
    await this.note(conv, `📞 ${viewer.name} pediu permissão para ligar pelo WhatsApp.`);
    return { ok: true };
  }

  /** Disca para o cliente e devolve o acesso do navegador do vendedor à ligação. */
  async start(orgId: string, conversationId: string, viewer: SellerViewer) {
    const conv = await this.load(orgId, conversationId, viewer);
    if (await this.simulated.isSimulatedContact(conv.contactId)) {
      throw new BadRequestException({ code: 'SEM_PERMISSAO', message: 'O cliente ainda não permitiu ligações' });
    }
    if (!this.dialer.configured) throw new BadRequestException('Conexão de ligações ainda não configurada');
    const permission = await this.graph.getPermission(conv.channel!, conv.contact!.phone!);
    if (!permission.canCall) throw new BadRequestException({ code: 'SEM_PERMISSAO', message: 'O cliente ainda não permitiu ligações' });
    const room = sellerRoom(conv.id);
    const numero = conv.contact!.phone!.replace(/\D/g, '');
    const access = this.dialer.joinAccess({ room, identity: `vendedor-${viewer.userId}`, name: viewer.name });
    const callId = await this.records.open({ organizationId: orgId, conversation: conv, agentId: viewer.userId, numero });
    // Transcritor (aviso de gravação + transcrição); se não entrar, a ligação segue sem resumo.
    await this.dialer
      .dispatchAgent(room, JSON.stringify({ missao: 'transcrever_vendedor', callId }))
      .catch((err: Error) => this.logger.warn(`Transcritor não entrou na sala ${room}: ${err.message}`));
    try {
      await this.dialer.dialForSeller({ room, phoneE164: `+${numero}`, contactName: conv.contact!.name ?? 'Cliente' });
    } catch (err) {
      await this.records.fail(callId).catch(() => undefined);
      await this.dialer.endRoom(room).catch(() => undefined);
      throw err;
    }
    this.logger.log(`Vendedor ${viewer.userId} ligou na conversa ${conv.id} (sala ${room}, ligação ${callId})`);
    return { room, callId, ...access };
  }

  /** Encerra: só salas desta conversa. */
  async end(orgId: string, conversationId: string, room: string, viewer: SellerViewer) {
    await this.load(orgId, conversationId, viewer);
    if (!room.startsWith(`vendedor-${conversationId}-`)) throw new BadRequestException('Ligação não pertence a esta conversa');
    await this.dialer.endRoom(room);
    return { ok: true };
  }

  private async note(conv: { id: string; channelId: string; contactId: string }, text: string) {
    const message = await this.prisma.message.create({
      data: { conversationId: conv.id, direction: OUTBOUND, type: SYSTEM, status: SENT, sentAt: new Date(), content: { text }, metadata: { source: 'seller-call' } },
    });
    this.realtime.emitToChannel(conv.channelId, 'message:new', { message, conversationId: conv.id, contactId: conv.contactId });
    this.realtime.emitToConversation(conv.id, 'message:new', { message });
  }
}
