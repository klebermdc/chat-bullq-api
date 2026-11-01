/** Mensagem do dia já reduzida ao que o diário usa. */
export interface DiaryMessage {
  conversationId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  /** `null` em mensagem de robô/automação. */
  senderId: string | null;
  text: string;
  at: Date;
}

export interface DiaryMetrics {
  conversations: number;
  messagesSent: number;
  /** `null` quando não houve resposta medível dentro do horário. */
  medianReplyMinutes: number | null;
  slowReplies: number;
  unansweredAtEndOfDay: number;
}

export interface DiaryTranscriptLine {
  role: 'CLIENTE' | 'ATENDENTE' | 'EQUIPE';
  text: string;
  /** Veio de antes do dia avaliado: serve de contexto, não é avaliada. */
  isContext: boolean;
}

export interface DiaryTranscript {
  /** Apelido curto enviado à IA (C1, C2...). */
  ref: string;
  conversationId: string;
  lines: DiaryTranscriptLine[];
}

export interface DiaryCriterion {
  name: string;
  description: string;
  instructions: string;
}

export interface DiaryPoint {
  criterion: string;
  title: string;
  explanation: string;
  conversationId: string;
  /** Fala real do atendente, conferida contra a conversa. */
  quote: string;
  suggestion: string | null;
}

export interface DiaryEvaluation {
  summary: string;
  strengths: DiaryPoint[];
  improvements: DiaryPoint[];
  /** Apontamentos da IA rejeitados na conferência (debug/qualidade). */
  discarded: number;
}

export type DiaryStatus = 'READY' | 'EMPTY' | 'FAILED';

/** Payload do job de geração de um diário. */
export interface DiaryGenerateJobData {
  organizationId: string;
  userId: string;
  day: string;
  force?: boolean;
}
