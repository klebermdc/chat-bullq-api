import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import {
  Conversation,
  ConversationStatus,
  MessageContentType,
  MessageDirection,
  MessageStatus,
  OrgRole,
  Prisma,
} from '@prisma/client';
import { ConversationsRepository, InboxFilters } from './conversations.repository';
import { resolveAssignmentScope } from './conversation-scope';
import { ConversationAccessService } from './conversation-access.service';
import { ConversationFsmService } from './conversation-fsm.service';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { PrismaService } from '../../../database/prisma.service';
import { ChannelAdapterRegistry } from '../../channel-hub/channel-adapter.registry';
import { HistoryImportService } from '../pipeline/history-import.service';
import {
  ChannelAccess,
  ChannelAccessService,
} from '../../iam/channel-access/channel-access.service';
import { AgentRouterService } from '../../ai-agents/router/agent-router.service';
import { AiAgentRunnerService } from '../../ai-agents/runner/agent-runner.service';
import { SegmentReadService } from '../../segments/segment-read.service';
import { ProjectsService } from '../../projects/projects.service';
import { deriveGroupJid } from '../../segments/group-jid.util';
import { ScheduledMessagesService } from '../../scheduling/scheduled-messages.service';
import {
  ConversationSummaryService,
  SummaryTurn,
} from '../messages/conversation-summary.service';
import { AttendantGreetingService } from '../attendant-greeting/attendant-greeting.service';

const SYNC_MESSAGE_PAGE_SIZE = 50;
const SYNC_MAX_PAGES = 4;

/** Valores de `assignedToId` que significam "sem responsável", não um id. */
const UNASSIGNED_TOKENS = new Set(['none', 'null', 'unassigned']);

function parseDate(v?: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
}

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly repository: ConversationsRepository,
    private readonly fsm: ConversationFsmService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly prisma: PrismaService,
    private readonly adapterRegistry: ChannelAdapterRegistry,
    private readonly historyImporter: HistoryImportService,
    private readonly channelAccess: ChannelAccessService,
    private readonly agentRouter: AgentRouterService,
    private readonly agentRunner: AiAgentRunnerService,
    private readonly segmentRead: SegmentReadService,
    private readonly projects: ProjectsService,
    private readonly conversationAccess: ConversationAccessService,
    @Inject(forwardRef(() => ScheduledMessagesService))
    private readonly scheduled: ScheduledMessagesService,
    private readonly summarizer: ConversationSummaryService,
    @Inject(forwardRef(() => AttendantGreetingService))
    private readonly attendantGreeting: AttendantGreetingService,
  ) {}

  /**
   * Anexa o `project` (resumo) às conversas de grupo — uma consulta em lote por
   * JID. Mutação in-place (mesma referência) para reusar nos vários retornos.
   */
  private async attachProjects<
    T extends {
      organizationId: string;
      isGroup: boolean;
      channelId: string;
      contact?: { channels?: { channelId: string; externalId: string }[] } | null;
    },
  >(organizationId: string, conversations: T[]): Promise<T[]> {
    const jidByConv = new Map<T, string>();
    for (const c of conversations) {
      if (!c.isGroup) continue;
      const jid = deriveGroupJid(c);
      if (jid) jidByConv.set(c, jid);
    }
    if (jidByConv.size === 0) return conversations;
    const map = await this.projects.attachByJids(
      organizationId,
      Array.from(new Set(jidByConv.values())),
    );
    for (const [conv, jid] of jidByConv) {
      (conv as Record<string, unknown>).project = map.get(jid) ?? null;
    }
    return conversations;
  }

  private broadcastUpdate(conversation: Conversation | null): void {
    if (!conversation) return;
    this.realtimeGateway.emitToChannel(
      conversation.channelId,
      'conversation:updated',
      { conversation },
    );
    this.realtimeGateway.emitToConversation(
      conversation.id,
      'conversation:updated',
      { conversation },
    );
  }

  async findInbox(
    organizationId: string,
    filters: {
      status?: string;
      /** Aba de atendimento: waiting | inbox | closed. */
      tab?: 'waiting' | 'inbox' | 'closed';
      /**
       * Mesmo sinal das abas, mas fixado por uma inbox view (que não usa
       * abas). Tem precedência sobre `tab` quando os dois vierem.
       */
      awaitingHumanReply?: boolean;
      channelId?: string;
      channelIds?: string[];
      conversationIds?: string[];
      kind?: 'INDIVIDUAL' | 'GROUP';
      tagIds?: string[];
      assignedToId?: string;
      /** Só conversas sem responsável (fila de distribuição). */
      assignedToNone?: boolean;
      search?: string;
      archived?: 'exclude' | 'only' | 'any';
      unreadOnly?: boolean;
      stuckOnly?: boolean;
      segmentId?: string;
      hoppeId?: string;
      responsibleUserId?: string;
      projectStatus?: string;
      dateFrom?: string;
      dateTo?: string;
    },
    page: number,
    limit: number,
    access: ChannelAccess = 'ALL',
    currentUserId?: string,
    role?: OrgRole,
  ) {
    const validStatuses = new Set(Object.values(ConversationStatus));
    const parsedStatuses = filters.status
      ?.split(',')
      .map((s) => s.trim() as ConversationStatus)
      .filter((s) => validStatuses.has(s));

    // Aba de atendimento → filtros concretos. `closed` fixa status=CLOSED;
    // `waiting`/`inbox` excluem fechadas e filtram pelo flag awaitingHumanReply.
    let tabStatuses: ConversationStatus[] | undefined;
    let tabAwaitingHumanReply: boolean | undefined;
    let tabExcludeClosed = false;
    if (filters.tab === 'closed') {
      tabStatuses = [ConversationStatus.CLOSED];
    } else if (filters.tab === 'waiting') {
      tabAwaitingHumanReply = true;
      tabExcludeClosed = true;
    } else if (filters.tab === 'inbox') {
      tabAwaitingHumanReply = false;
      tabExcludeClosed = true;
    }

    // Uma inbox view pode fixar o mesmo sinal sem passar por aba (views têm
    // semântica própria e não usam as abas). Ex.: "Distribuição" = fila de
    // handoff. Vale a mesma regra da aba: fechadas ficam de fora, porque um
    // atendimento encerrado não está esperando ninguém.
    const awaitingHumanReply =
      filters.awaitingHumanReply ?? tabAwaitingHumanReply;
    const excludeClosed =
      tabExcludeClosed || filters.awaitingHumanReply !== undefined;

    // Filtros que unificam por grupo POR LEITURA (Segmento ou Projeto): pegam
    // uma conversa representante por grupo (JID) e listam só essas — uma linha
    // por grupo, sem duplicar. Resolvem para conversationIds + channelIds; o
    // channelIds dá ao planner o índice (org,channel) e evita varrer o índice
    // de last_message_at (query O(segundos)).
    let conversationIds = filters.conversationIds;
    let resolvedChannelIds: string[] | undefined;
    let isGroupResolved = false;
    const projectFilter =
      filters.hoppeId || filters.responsibleUserId || filters.projectStatus
        ? {
            hoppeId: filters.hoppeId,
            responsibleUserId: filters.responsibleUserId,
            status: filters.projectStatus,
          }
        : null;

    if (filters.segmentId || projectFilter) {
      const { representativeIds, memberChannelIds } = filters.segmentId
        ? await this.segmentRead.groupRepresentativeIds(
            organizationId,
            filters.segmentId,
          )
        : await this.projects.resolveFilter(organizationId, projectFilter!);
      conversationIds = filters.conversationIds
        ? representativeIds.filter((id) => filters.conversationIds!.includes(id))
        : representativeIds;
      resolvedChannelIds = memberChannelIds;
      isGroupResolved = true;
      if (conversationIds.length === 0) {
        return {
          conversations: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        };
      }
    }

    // O status explícito (filtro avançado) tem precedência sobre o da aba.
    const effectiveStatuses = parsedStatuses?.length
      ? parsedStatuses
      : tabStatuses;

    const inboxFilters: InboxFilters = {
      organizationId,
      status: effectiveStatuses?.length ? effectiveStatuses : undefined,
      awaitingHumanReply,
      excludeClosed,
      // Em filtro de grupo (segmento/projeto) o canal vira o conjunto de
      // canais resolvidos (necessário pro plano da query); senão, o do usuário.
      channelId: isGroupResolved ? undefined : filters.channelId,
      channelIds: isGroupResolved ? resolvedChannelIds : filters.channelIds,
      conversationIds,
      kind: isGroupResolved ? 'GROUP' : filters.kind,
      tagIds: filters.tagIds,
      // Query string também pode pedir "sem responsável" (?assignedToId=none).
      // Normalizar aqui garante que nenhum sentinel textual chegue ao Prisma
      // como se fosse um id de usuário.
      assignedToId: UNASSIGNED_TOKENS.has(filters.assignedToId ?? '')
        ? undefined
        : filters.assignedToId,
      assignedToNone:
        filters.assignedToNone ||
        UNASSIGNED_TOKENS.has(filters.assignedToId ?? '') ||
        undefined,
      enforceAssignedToId: currentUserId
        ? resolveAssignmentScope(role, currentUserId)
        : undefined,
      search: filters.search,
      accessibleChannelIds: access === 'ALL' ? undefined : [...access],
      archived: filters.archived,
      unreadOnly: filters.unreadOnly,
      stuckOnly: filters.stuckOnly,
      dateFrom: parseDate(filters.dateFrom),
      dateTo: parseDate(filters.dateTo),
    };

    const skip = (page - 1) * limit;
    const { conversations, total } = await this.repository.findInbox(
      inboxFilters,
      skip,
      limit,
      currentUserId,
    );

    await this.attachProjects(organizationId, conversations as any[]);

    return {
      conversations,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(
    id: string,
    organizationId: string,
    access: ChannelAccess = 'ALL',
    currentUserId?: string,
    role?: OrgRole,
  ) {
    const conversation = await this.repository.findById(id);
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.organizationId !== organizationId) {
      throw new ForbiddenException();
    }
    this.channelAccess.assertChannelAccess(access, conversation.channelId);
    if (
      currentUserId &&
      resolveAssignmentScope(role, currentUserId) &&
      conversation.assignedToId !== currentUserId
    ) {
      throw new ForbiddenException();
    }
    await this.attachProjects(organizationId, [conversation as any]);
    return conversation;
  }

  /**
   * Garante que o usuário pode agir sobre a conversa.
   * AGENT só alcança conversa atribuída a ele. OWNER/ADMIN passam direto.
   * Lança NotFound — e não Forbidden — para não confirmar a existência da conversa alheia.
   *
   * Guarda ÚNICA e compartilhada para os métodos de escrita (update, transfer,
   * toggleAi, engageAi, setActiveAgent, close, reopen, assignToMe) e reusada
   * pelo MessagesService (send/revoke). Propositalmente NÃO reusa `findOne`:
   * esta checagem é barata (um único findFirst) e não faz o attachProjects
   * que as mutações não precisam.
   *
   * Implementação mora em `ConversationAccessService` (leaf service, só
   * depende de PrismaService) — delega pra não duplicar a lógica nem
   * reintroduzir o ciclo de DI que injetar `ConversationsService` inteiro
   * causava nos outros módulos consumidores.
   */
  async assertConversationAccess(
    id: string,
    organizationId: string,
    role?: OrgRole,
    currentUserId?: string,
  ) {
    return this.conversationAccess.assertConversationAccess(
      id,
      organizationId,
      role,
      currentUserId,
    );
  }

  /**
   * Resumo IA do Painel Inteligente. Cache barato: reaproveita `lastMessageAt`
   * — o resumo é fresco enquanto `aiSummaryUpToAt` for igual ao `lastMessageAt`
   * atual. Chegou mensagem nova → divergem → regenera. Só gera para conversas
   * com >= 2 mensagens de texto (nada a resumir antes).
   */
  async getAiSummary(
    id: string,
    organizationId: string,
    access: ChannelAccess = 'ALL',
    currentUserId?: string,
    role?: OrgRole,
    opts: { refresh?: boolean } = {},
  ): Promise<{
    summary: string | null;
    sentiment: string | null;
    generatedAt: string | null;
    cached: boolean;
    tooShort?: boolean;
    objection: string | null;
    replies: string[];
  }> {
    const conversation: any = await this.findOne(
      id,
      organizationId,
      access,
      currentUserId,
      role,
    );

    const total = await this.prisma.message.count({ where: { conversationId: id } });
    if (total < 2) {
      return {
        summary: null,
        sentiment: null,
        generatedAt: null,
        cached: false,
        tooShort: true,
        objection: null,
        replies: [],
      };
    }

    const upTo = conversation.aiSummaryUpToAt as Date | null;
    const last = conversation.lastMessageAt as Date | null;
    const fresh =
      !opts.refresh &&
      conversation.aiSummary &&
      upTo != null &&
      last != null &&
      upTo.getTime() === last.getTime();

    if (fresh) {
      const savedReplies = (conversation.aiReplies ?? {}) as {
        objecao?: string | null;
        respostas?: string[];
      };
      return {
        summary: conversation.aiSummary,
        sentiment: conversation.aiSummarySentiment,
        generatedAt: conversation.aiSummaryAt
          ? new Date(conversation.aiSummaryAt).toISOString()
          : null,
        cached: true,
        objection: savedReplies.objecao ?? null,
        replies: Array.isArray(savedReplies.respostas) ? savedReplies.respostas : [],
      };
    }

    // Últimas 40 mensagens em ordem cronológica (asc): skip = total - 40 pula
    // direto para o final sem precisar buscar em desc + reverter em memória.
    const MAX_TURNS = 40;
    const skip = Math.max(total - MAX_TURNS, 0);
    const rows = await this.prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      skip,
      take: MAX_TURNS,
      select: { direction: true, type: true, content: true },
    });

    const turns: SummaryTurn[] = rows
      .map((m) => ({
        direction: m.direction as 'INBOUND' | 'OUTBOUND',
        text: m.type === 'TEXT' ? this.messageText(m.content) : '',
      }))
      .filter((t) => t.text.length > 0);

    if (turns.length < 2) {
      // Cache estava velho mas não há texto novo suficiente pra regenerar. Se já
      // existe um resumo salvo, devolvê-lo é melhor UX do que apagar o painel.
      if (conversation.aiSummary) {
        const savedReplies = (conversation.aiReplies ?? {}) as {
          objecao?: string | null;
          respostas?: string[];
        };
        return {
          summary: conversation.aiSummary,
          sentiment: conversation.aiSummarySentiment,
          generatedAt: conversation.aiSummaryAt
            ? new Date(conversation.aiSummaryAt).toISOString()
            : null,
          cached: true,
          objection: savedReplies.objecao ?? null,
          replies: Array.isArray(savedReplies.respostas) ? savedReplies.respostas : [],
        };
      }
      return {
        summary: null,
        sentiment: null,
        generatedAt: null,
        cached: false,
        tooShort: true,
        objection: null,
        replies: [],
      };
    }

    const result = await this.summarizer.summarize(organizationId, turns);
    const generatedAt = new Date();

    // Cache se auto-cura: `aiSummaryUpToAt` grava o snapshot pré-LLM (`last`), então
    // uma mensagem que chegue no meio da geração só dispara um regenerate inofensivo
    // na próxima abertura.
    await this.prisma.conversation.update({
      where: { id },
      data: {
        aiSummary: result.summary,
        aiSummarySentiment: result.sentiment,
        aiSummaryAt: generatedAt,
        aiSummaryUpToAt: last,
        aiReplies: {
          objecao: result.objection,
          respostas: result.replies,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      summary: result.summary,
      sentiment: result.sentiment,
      generatedAt: generatedAt.toISOString(),
      cached: false,
      objection: result.objection,
      replies: result.replies,
    };
  }

  /** Extrai texto do content JSON de uma mensagem (TEXT tem `content.text`). */
  private messageText(content: unknown): string {
    if (content && typeof content === 'object') {
      const t = (content as Record<string, unknown>).text;
      if (typeof t === 'string') return t.trim();
    }
    return '';
  }

  async update(
    id: string,
    organizationId: string,
    dto: UpdateConversationDto,
    actorId: string,
    access: ChannelAccess = 'ALL',
    role?: OrgRole,
  ) {
    await this.assertConversationAccess(id, organizationId, role, actorId);
    const conversation = await this.findOne(id, organizationId, access);

    const assigneeChanged =
      !!dto.assignedToId && dto.assignedToId !== conversation.assignedToId;
    if (dto.assignedToId) {
      await this.fsm.assign(id, dto.assignedToId, actorId);
    }

    if (dto.status && dto.status !== conversation.status) {
      await this.fsm.transition(id, dto.status, actorId);
    }

    if (dto.departmentId) {
      await this.repository.update(id, { department: { connect: { id: dto.departmentId } } });
    }

    if (dto.subject !== undefined) {
      const trimmed = dto.subject.trim();
      await this.repository.update(id, {
        subject: trimmed.length > 0 ? trimmed : null,
      });
    }

    const updated = await this.repository.findById(id);
    this.broadcastUpdate(updated as Conversation | null);

    if (assigneeChanged) {
      await this.attendantGreeting.greet({
        conversationId: id,
        attendantUserId: dto.assignedToId!,
        source: 'MANUAL_ASSIGN',
      });
    }

    return updated;
  }

  /**
   * Transferência intencional do cliente para outro atendente. Diferente do
   * auto-assign (que acontece implicitamente ao responder), aqui o ator move
   * o card de propósito e a transferência fica REGISTRADA no thread como uma
   * mensagem SYSTEM ("🔄 Cliente transferido de X para Y"), visível a todos.
   *
   * Reusa `fsm.assign` (audit log ASSIGNED + trigger de automação). A mensagem
   * SYSTEM é criada direto no banco, com status SENT e sem entrar na fila de
   * entrega — portanto NÃO é enviada ao cliente no WhatsApp/IG.
   */
  async transfer(
    id: string,
    organizationId: string,
    toUserId: string,
    actorId: string,
    reason?: string,
    access: ChannelAccess = 'ALL',
    role?: OrgRole,
  ) {
    await this.assertConversationAccess(id, organizationId, role, actorId);
    const conversation = await this.findOne(id, organizationId, access);

    if (conversation.assignedToId === toUserId) {
      throw new BadRequestException(
        'A conversa já está atribuída a este atendente.',
      );
    }

    // Destinatário precisa ser membro ativo da mesma org.
    const target = await this.prisma.userOrganization.findFirst({
      where: { organizationId, userId: toUserId, user: { isActive: true } },
      select: { user: { select: { id: true, name: true } } },
    });
    if (!target) {
      throw new NotFoundException('Atendente destino não encontrado na organização.');
    }

    const fromUser = conversation.assignedToId
      ? await this.prisma.user.findUnique({
          where: { id: conversation.assignedToId },
          select: { name: true },
        })
      : null;

    await this.fsm.assign(id, toUserId, actorId);

    const fromLabel = fromUser?.name ?? 'ninguém';
    const toLabel = target.user.name ?? 'atendente';
    const trimmedReason = reason?.trim();
    const text = trimmedReason
      ? `🔄 Cliente transferido de ${fromLabel} para ${toLabel}. Motivo: ${trimmedReason}`
      : `🔄 Cliente transferido de ${fromLabel} para ${toLabel}`;

    const systemMessage = await this.prisma.message.create({
      data: {
        conversationId: id,
        direction: MessageDirection.OUTBOUND,
        type: MessageContentType.SYSTEM,
        status: MessageStatus.SENT,
        senderId: actorId,
        sentAt: new Date(),
        content: {
          text,
          transfer: {
            fromId: conversation.assignedToId,
            toId: toUserId,
            reason: trimmedReason ?? null,
          },
        },
      },
    });

    // Aparece no thread na hora (SYSTEM message não passa pelo fluxo de send).
    this.realtimeGateway.emitToChannel(conversation.channelId, 'message:new', {
      message: systemMessage,
      conversationId: id,
      contactId: conversation.contactId,
    });
    this.realtimeGateway.emitToConversation(id, 'message:new', {
      message: systemMessage,
    });

    const updated = await this.repository.findById(id);
    this.broadcastUpdate(updated as Conversation | null);

    await this.attendantGreeting.greet({
      conversationId: id,
      attendantUserId: toUserId,
      source: 'TRANSFER',
    });

    return updated;
  }

  async toggleAi(
    id: string,
    organizationId: string,
    enabled: boolean | null,
    actorId: string,
    access: ChannelAccess = 'ALL',
    role?: OrgRole,
  ) {
    await this.assertConversationAccess(id, organizationId, role, actorId);
    await this.findOne(id, organizationId, access);

    // Tri-state:
    //   null  = limpa override, conversa volta a seguir regras globais
    //   true  = força ON (sobrepõe kill switch e horário)
    //   false = força OFF
    const updated = await this.prisma.conversation.update({
      where: { id },
      data:
        enabled === null
          ? {
              aiEnabled: null,
              aiDisabledBy: null,
              aiDisabledAt: null,
            }
          : enabled === true
            ? {
                aiEnabled: true,
                aiDisabledBy: null,
                aiDisabledAt: null,
              }
            : {
                aiEnabled: false,
                aiDisabledBy: actorId,
                aiDisabledAt: new Date(),
                activeAgentId: null,
              },
    });

    await this.prisma.conversationAuditLog.create({
      data: {
        conversationId: id,
        actorId,
        action:
          enabled === null
            ? 'AI_OVERRIDE_CLEARED'
            : enabled
              ? 'AI_FORCED_ON'
              : 'AI_FORCED_OFF',
        metadata: {},
      },
    });
    this.realtimeGateway.emitToConversation(id, 'conversation:ai-toggle', {
      conversationId: id,
      aiEnabled: enabled,
      actorId,
    });
    return updated;
  }

  /**
   * Manually trigger the AI agent to engage with this conversation right now.
   * Reads the latest inbound (or any latest message if no inbound) as the
   * trigger, calls the runner, and returns whatever final action the agent
   * decided. Skipped silently if the router rejects (paused, no agent, etc).
   */
  async engageAi(
    id: string,
    organizationId: string,
    actorId: string,
    access: ChannelAccess = 'ALL',
    role?: OrgRole,
  ): Promise<{ engaged: boolean; reason?: string }> {
    await this.assertConversationAccess(id, organizationId, role, actorId);
    const conversation = await this.findOne(id, organizationId, access);

    const decision = await this.agentRouter.shouldHandle(
      conversation as Conversation,
    );
    if (!decision.handle) {
      this.logger.log(
        `engageAi skipped for conv ${id}: ${decision.reason} (actor=${actorId})`,
      );
      return { engaged: false, reason: decision.reason };
    }

    // Pick the most recent inbound as the trigger so the agent has something
    // concrete to react to. Fall back to the latest message of any direction
    // (covers the case where the conversation was opened by the human).
    const triggerMessage =
      (await this.prisma.message.findFirst({
        where: { conversationId: id, direction: 'INBOUND' },
        orderBy: { createdAt: 'desc' },
      })) ??
      (await this.prisma.message.findFirst({
        where: { conversationId: id },
        orderBy: { createdAt: 'desc' },
      }));

    if (!triggerMessage) {
      return { engaged: false, reason: 'no-messages' };
    }

    await this.prisma.conversationAuditLog.create({
      data: {
        conversationId: id,
        actorId,
        action: 'AI_ENGAGED_MANUALLY',
        metadata: { triggerMessageId: triggerMessage.id },
      },
    });

    // Runner is async — kick it off in the background. The response payload
    // (new outbound message) will arrive via realtime + the run record will
    // appear in /ai-agents stats. Frontend can refetch right after the call.
    this.agentRunner
      .run({ conversation: conversation as Conversation, triggerMessage })
      .catch((err) =>
        this.logger.error(
          `engageAi run failed for conv ${id}: ${err?.message ?? err}`,
        ),
      );

    return { engaged: true };
  }

  /**
   * Manually pin a specific AI agent to this conversation and immediately
   * engage it. Use case: human says "vou te passar pra Lívia" via manual
   * message — the system can't infer that intent from text, so the operator
   * picks the agent in the UI and we (a) flip activeAgentId, (b) clear any
   * paused state (force AI on for this conversation), (c) fire the runner.
   */
  async setActiveAgent(
    id: string,
    organizationId: string,
    agentId: string,
    actorId: string,
    access: ChannelAccess = 'ALL',
    role?: OrgRole,
  ): Promise<{ engaged: boolean; reason?: string; agentName?: string }> {
    await this.assertConversationAccess(id, organizationId, role, actorId);
    const conversation = await this.findOne(id, organizationId, access);

    const agent = await this.prisma.aiAgent.findFirst({
      where: { id: agentId, organizationId, isActive: true, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!agent) {
      throw new NotFoundException('Agent not found or not active in this org');
    }

    // Pin agent + force AI on for this conversation (override any pause).
    const updated = await this.prisma.conversation.update({
      where: { id },
      data: {
        activeAgentId: agentId,
        aiEnabled: true,
        aiDisabledBy: null,
        aiDisabledAt: null,
      },
    });

    await this.prisma.conversationAuditLog.create({
      data: {
        conversationId: id,
        actorId,
        action: 'AI_AGENT_SET',
        fromValue: conversation.activeAgentId,
        toValue: agentId,
        metadata: { agentName: agent.name },
      },
    });

    this.broadcastUpdate(updated as Conversation);
    this.realtimeGateway.emitToConversation(id, 'conversation:ai-toggle', {
      conversationId: id,
      aiEnabled: true,
      activeAgentId: agentId,
      reason: 'agent-pinned',
    });

    // Pick latest inbound (preferred) or fallback to any latest message.
    const triggerMessage =
      (await this.prisma.message.findFirst({
        where: { conversationId: id, direction: 'INBOUND' },
        orderBy: { createdAt: 'desc' },
      })) ??
      (await this.prisma.message.findFirst({
        where: { conversationId: id },
        orderBy: { createdAt: 'desc' },
      }));

    if (!triggerMessage) {
      return {
        engaged: false,
        reason: 'no-messages',
        agentName: agent.name,
      };
    }

    this.agentRunner
      .run({
        conversation: updated as Conversation,
        triggerMessage,
      })
      .catch((err) =>
        this.logger.error(
          `setActiveAgent run failed for conv ${id}: ${err?.message ?? err}`,
        ),
      );

    return { engaged: true, agentName: agent.name };
  }

  async close(
    id: string,
    organizationId: string,
    actorId: string,
    access: ChannelAccess = 'ALL',
    role?: OrgRole,
  ) {
    await this.assertConversationAccess(id, organizationId, role, actorId);
    await this.findOne(id, organizationId, access);
    await this.fsm.transition(id, ConversationStatus.CLOSED, actorId);
    const updated = await this.repository.findById(id);
    this.scheduled
      .cancelPendingForConversation(id, 'conversation_closed')
      .catch(() => undefined);
    this.broadcastUpdate(updated as Conversation | null);
    return updated;
  }

  async reopen(
    id: string,
    organizationId: string,
    actorId: string,
    access: ChannelAccess = 'ALL',
    role?: OrgRole,
  ) {
    await this.assertConversationAccess(id, organizationId, role, actorId);
    const conversation = await this.findOne(id, organizationId, access);
    const target = conversation.assignedToId
      ? ConversationStatus.OPEN
      : ConversationStatus.PENDING;
    await this.fsm.transition(id, target, actorId);
    const updated = await this.repository.findById(id);
    this.broadcastUpdate(updated as Conversation | null);
    return updated;
  }

  /**
   * Hard delete — apaga a conversa de verdade. Cascade nas FKs (messages,
   * tags, audit logs, AI runs, reads, internal notes, rating, cards) cuida
   * dos dependentes. Operação irreversível: exige confirmação digitando o
   * nome ou telefone exato do contato.
   */
  async hardDelete(
    id: string,
    organizationId: string,
    access: ChannelAccess = 'ALL',
    confirm?: string,
  ) {
    const conversation = await this.findOne(id, organizationId, access);
    const expectedName = (conversation as any).contact?.name?.trim();
    const expectedPhone = (conversation as any).contact?.phone?.trim();
    const provided = (confirm ?? '').trim();
    if (!provided) {
      throw new BadRequestException(
        'Confirmação obrigatória: passe ?confirm=<nome ou telefone exato do contato>.',
      );
    }
    if (provided !== expectedName && provided !== expectedPhone) {
      throw new BadRequestException(
        'Confirmação não confere com o nome ou telefone do contato — apagamento abortado.',
      );
    }

    // FKs estão com onDelete: Cascade nos relacionados (messages,
    // conversation_tags, ai_agent_runs, conversation_reads, etc.) então
    // basta apagar a conversa que o resto cai junto.
    await this.prisma.conversation.delete({ where: { id } });

    this.realtimeGateway.emitToChannel(
      conversation.channelId,
      'conversation:deleted',
      { conversationId: id },
    );
    return { ok: true, id };
  }

  async setArchived(
    id: string,
    organizationId: string,
    archived: boolean,
    actorId: string,
    access: ChannelAccess = 'ALL',
  ) {
    await this.findOne(id, organizationId, access);
    const updated = await this.prisma.conversation.update({
      where: { id },
      data: archived
        ? { isArchived: true, archivedAt: new Date(), archivedById: actorId }
        : { isArchived: false, archivedAt: null, archivedById: null },
    });

    await this.prisma.conversationAuditLog.create({
      data: {
        conversationId: id,
        actorId,
        action: archived ? 'CONVERSATION_ARCHIVED' : 'CONVERSATION_UNARCHIVED',
        metadata: {},
      },
    });

    if (archived) {
      this.scheduled
        .cancelPendingForConversation(id, 'conversation_closed')
        .catch(() => undefined);
    }

    this.broadcastUpdate(updated as Conversation);
    return updated;
  }

  /**
   * Move a conversa entre as abas "Esperando" e "Caixa de entrada" manualmente.
   * A aba Esperando é derivada do flag `awaitingHumanReply` (true = cliente
   * aguardando resposta humana). Normalmente o flag é ligado por uma inbound
   * e desligado quando um operador responde — este método é o override manual
   * pedido pela equipe (menu de contexto: "Colocar/Retirar do esperando").
   */
  async setWaiting(
    id: string,
    organizationId: string,
    waiting: boolean,
    actorId: string,
    access: ChannelAccess = 'ALL',
  ) {
    await this.findOne(id, organizationId, access);
    const updated = await this.prisma.conversation.update({
      where: { id },
      data: { awaitingHumanReply: waiting },
    });

    await this.prisma.conversationAuditLog.create({
      data: {
        conversationId: id,
        actorId,
        action: waiting ? 'MARKED_WAITING' : 'UNMARKED_WAITING',
        metadata: {},
      },
    });

    this.broadcastUpdate(updated as Conversation);
    return updated;
  }

  /**
   * AGENT só "reivindica" a própria conversa — o guard abaixo é o MESMO usado
   * nas demais mutações, sem caso especial: se `assertConversationAccess`
   * passar, a conversa já é do usuário (ou ele é OWNER/ADMIN), então
   * `fsm.assign(id, userId, userId)` vira um no-op. Isso torna IMPOSSÍVEL um
   * AGENT reivindicar conversa alheia — decisão de produto: conversa sem
   * dono é distribuída por Admin/Owner, não "roubada" via self-claim.
   */
  async assignToMe(
    id: string,
    organizationId: string,
    userId: string,
    access: ChannelAccess = 'ALL',
    role?: OrgRole,
  ) {
    await this.assertConversationAccess(id, organizationId, role, userId);
    await this.findOne(id, organizationId, access);
    await this.fsm.assign(id, userId, userId);
    const updated = await this.repository.findById(id);
    this.broadcastUpdate(updated as Conversation | null);
    return updated;
  }

  async getStatusCounts(
    organizationId: string,
    access: ChannelAccess = 'ALL',
    currentUserId?: string,
    role?: OrgRole,
  ) {
    const accessibleIds = access === 'ALL' ? undefined : [...access];
    const enforceAssignedToId = currentUserId
      ? resolveAssignmentScope(role, currentUserId)
      : undefined;
    return this.repository.countByStatus(
      organizationId,
      accessibleIds,
      enforceAssignedToId,
    );
  }

  /** Contagem das abas de atendimento (Esperando / Caixa de entrada / Finalizados). */
  async getTabCounts(
    organizationId: string,
    access: ChannelAccess = 'ALL',
    currentUserId?: string,
    role?: OrgRole,
    channelId?: string,
  ) {
    const accessibleIds = access === 'ALL' ? undefined : [...access];
    const enforceAssignedToId = currentUserId
      ? resolveAssignmentScope(role, currentUserId)
      : undefined;
    return this.repository.countByTab(organizationId, {
      accessibleChannelIds: accessibleIds,
      enforceAssignedToId,
      channelId,
    });
  }

  /**
   * Marks a conversation as read for the current user. Upserts the
   * ConversationRead row with lastReadAt = now and emits a realtime
   * `conversation:read` event so any open client (other tab, mobile)
   * zeros the badge in real time.
   */
  async markAsRead(
    conversationId: string,
    organizationId: string,
    userId: string,
    access: ChannelAccess = 'ALL',
    lastReadMessageId?: string,
  ) {
    await this.findOne(conversationId, organizationId, access);
    const read = await this.repository.markAsRead(
      userId,
      conversationId,
      lastReadMessageId,
    );

    this.realtimeGateway.emitToUser(userId, 'conversation:read', {
      conversationId,
      userId,
      lastReadAt: read.lastReadAt,
    });

    return { ok: true, lastReadAt: read.lastReadAt };
  }

  /**
   * Per-user "mark as unread". Pushes lastReadAt before the latest inbound so
   * the conversation re-surfaces as unread for THIS user only. Other users'
   * read state is untouched.
   */
  async markAsUnread(
    conversationId: string,
    organizationId: string,
    userId: string,
    access: ChannelAccess = 'ALL',
  ) {
    await this.findOne(conversationId, organizationId, access);
    const result = await this.repository.markAsUnread(userId, conversationId);

    this.realtimeGateway.emitToUser(userId, 'conversation:unread', {
      conversationId,
      userId,
      unreadCount: result.unreadCount,
    });

    return { ok: true, unreadCount: result.unreadCount };
  }

  /**
   * On-demand sync of a single conversation: pulls the latest messages from
   * the channel provider (e.g. Zappfy) and merges them with what we already
   * have locally. The webhook covers the steady state — this is the recovery
   * path for when an event was missed (provider downtime, webhook hiccup,
   * channel reconnected, etc.).
   */
  async syncMessages(id: string, organizationId: string, access: ChannelAccess = 'ALL') {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: {
        channel: true,
        contact: {
          include: {
            channels: true,
          },
        },
      },
    });

    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.organizationId !== organizationId) {
      throw new ForbiddenException();
    }
    this.channelAccess.assertChannelAccess(access, conversation.channelId);

    const adapter = this.adapterRegistry.getHistorySync(conversation.channel.type);
    if (!adapter) {
      throw new BadRequestException(
        `Channel type ${conversation.channel.type} does not support sync`,
      );
    }

    const externalId = this.resolveExternalConversationId(conversation);
    if (!externalId) {
      throw new BadRequestException(
        'Cannot sync: conversation has no external chat id',
      );
    }

    let cursor: string | undefined;
    let imported = 0;
    let fetched = 0;
    let pages = 0;

    try {
      do {
        const result = await adapter.fetchMessages(
          conversation.channel,
          externalId,
          {},
          cursor,
          SYNC_MESSAGE_PAGE_SIZE,
        );
        fetched += result.messages.length;
        if (result.messages.length === 0) break;

        const res = await this.historyImporter.importMessages(
          conversation.channel,
          conversation.id,
          result.messages,
        );
        imported += res.imported;
        cursor = result.nextCursor;
        pages++;

        // Stop early once we hit a page where everything was already known —
        // the provider returns newest-first, so older pages can only be older
        // than what we already imported.
        if (res.imported === 0) break;
      } while (cursor && pages < SYNC_MAX_PAGES);
    } catch (err: any) {
      this.logger.error(
        `Failed to sync conversation ${id}: ${err.message}`,
        err.stack,
      );
      throw new BadRequestException(
        `Sync failed: ${err.response?.data?.message || err.message}`,
      );
    }

    if (imported > 0) {
      await this.historyImporter.notifyConversationImported(
        organizationId,
        conversation.id,
      );
    }

    this.logger.log(
      `Conversation ${id} synced: ${imported} new, ${fetched - imported} already known`,
    );

    return {
      imported,
      fetched,
      syncedAt: new Date().toISOString(),
    };
  }

  private resolveExternalConversationId(conversation: {
    channelId: string;
    metadata: any;
    contact: { channels: { channelId: string; externalId: string }[] };
  }): string | null {
    const fromMetadata =
      conversation.metadata &&
      typeof conversation.metadata === 'object' &&
      'externalConversationId' in conversation.metadata
        ? String((conversation.metadata as any).externalConversationId)
        : null;
    if (fromMetadata) return fromMetadata;

    const contactChannel = conversation.contact.channels.find(
      (c) => c.channelId === conversation.channelId,
    );
    return contactChannel?.externalId ?? null;
  }
}
