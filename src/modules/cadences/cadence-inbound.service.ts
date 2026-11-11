import { Injectable, Logger } from '@nestjs/common';
import { CadenceEnrollment } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { EnrollmentsRepository } from './enrollments.repository';
import { CadencesRepository } from './cadences.repository';
import {
  ResponseClassifierService,
  ClassifierMessage,
  ClassifierStep,
  ClassifyOutcome,
} from './response-classifier.service';
import {
  CadenceTransitionService,
  TransitionOutcome,
  TransitionCadence,
} from './cadence-transition.service';

/**
 * Hook fino de inbound: quando o cliente responde numa conversa com cadência
 * ACTIVE, classifica a resposta e aplica a transição correspondente.
 *
 * Chamado (fire-and-forget) pelo `InboundMessageProcessor`. No-op quando não há
 * enrollment ativo na conversa.
 */
@Injectable()
export class CadenceInboundService {
  private readonly logger = new Logger(CadenceInboundService.name);

  constructor(
    private readonly enrollments: EnrollmentsRepository,
    private readonly cadences: CadencesRepository,
    private readonly classifier: ResponseClassifierService,
    private readonly transition: CadenceTransitionService,
    private readonly prisma: PrismaService,
  ) {}

  async handleInbound(
    conversationId: string,
    message: ClassifierMessage,
  ): Promise<void> {
    // FIX 6: inbound não-acionável não deve forçar handoff. Reação/sistema ou
    // uma mensagem sem botão nativo e sem texto significativo é no-op aqui — os
    // toques pendentes já foram cancelados no inbound (FIX 5), então futuros
    // toques param sem descartar/entregar o lead ao humano por engano.
    if (!this.isActionable(message)) return;

    const enrollment =
      await this.enrollments.findLiveByConversation(conversationId);
    if (!enrollment) return; // sem cadência ativa → no-op

    const cadence = await this.cadences.findById(enrollment.cadenceId);
    if (!cadence) return;

    // Vendedor já está conversando com o cliente: a cadência não fala mais
    // nada (nem "Já vou te encaminhar…", nem toque novo). Só encerra calada.
    if (await this.sellerTookOver(enrollment)) {
      this.logger.log(
        `cadence_seller_took_over conv=${conversationId} enrollment=${enrollment.id}`,
      );
      await this.transition.apply(
        enrollment,
        'SELLER_TOOK_OVER',
        cadence as TransitionCadence,
      );
      return;
    }

    // Reengajamento de entrada: qualquer resposta faz a Aline reassumir; só o
    // opt-out desvia. Não classifica Sim/Não nem faz handoff a humano.
    if ((cadence as { trigger?: string }).trigger === 'NO_REPLY') {
      const outcome = await this.classifier.classify(
        { ...message, organizationId: enrollment.organizationId },
        {} as ClassifierStep,
      );
      await this.transition.apply(
        enrollment,
        outcome === 'DESCADASTRAR' ? 'DESCADASTRAR' : 'RESUMED',
        cadence as TransitionCadence,
      );
      return;
    }

    const step = (cadence.steps?.find(
      (s) => s.order === enrollment.currentStep,
    ) ?? {}) as ClassifierStep;

    // O LLM precisa do organizationId (resolve a chave do provedor); anexa a
    // partir do enrollment antes de classificar.
    const outcome = await this.classifier.classify(
      { ...message, organizationId: enrollment.organizationId },
      step,
    );

    await this.transition.apply(
      enrollment,
      this.toTransitionOutcome(outcome),
      cadence as TransitionCadence,
    );
  }

  /**
   * Um humano respondeu depois da última ação da cadência (toque enviado,
   * pausa ou início)? Então o cliente está falando com o vendedor, não com a
   * cadência. `lastHumanReplyAt` só é gravado por mensagem de atendente (as
   * automáticas e as do bot não contam).
   */
  private async sellerTookOver(enrollment: CadenceEnrollment): Promise<boolean> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: enrollment.conversationId },
      select: { lastHumanReplyAt: true },
    });
    const humanAt = conversation?.lastHumanReplyAt;
    if (!humanAt) return false;

    const lastCadenceActionAt = Math.max(
      ...[enrollment.startedAt, enrollment.lastStepAt, enrollment.pausedAt]
        .filter((d): d is Date => d instanceof Date)
        .map((d) => d.getTime()),
      0,
    );
    return humanAt.getTime() > lastCadenceActionAt;
  }

  /**
   * Só um botão nativo OU texto genuíno pode dirigir uma transição. Reações,
   * eventos de sistema e mensagens vazias (só whitespace) são não-acionáveis.
   */
  private isActionable(message: ClassifierMessage): boolean {
    const type = (message as { type?: unknown }).type;
    if (type === 'REACTION' || type === 'SYSTEM') return false;

    const md = (message?.metadata ?? {}) as Record<string, unknown>;
    const hasButton =
      typeof md.buttonId === 'string' && md.buttonId.trim().length > 0;
    if (hasButton) return true;

    const content = (message?.content ?? {}) as Record<string, unknown>;
    const hasText =
      typeof content.text === 'string' && content.text.trim().length > 0;
    return hasText;
  }

  /** AMBIGUO nunca descarta o lead → trata como engajou (regra de ouro). */
  private toTransitionOutcome(outcome: ClassifyOutcome): TransitionOutcome {
    switch (outcome) {
      case 'SIM':
        return 'SIM';
      case 'NAO':
        return 'NAO';
      case 'DESCADASTRAR':
        return 'DESCADASTRAR';
      case 'AMBIGUO':
      default:
        return 'ENGAGED';
    }
  }
}
