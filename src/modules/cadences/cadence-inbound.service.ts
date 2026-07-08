import { Injectable, Logger } from '@nestjs/common';
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
      await this.enrollments.findActiveByConversation(conversationId);
    if (!enrollment) return; // sem cadência ativa → no-op

    const cadence = await this.cadences.findById(enrollment.cadenceId);
    if (!cadence) return;

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
