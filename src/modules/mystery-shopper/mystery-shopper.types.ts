export type Score = 0 | 1 | 2;

export interface VisitMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  senderId: string | null;
  isAutomated: boolean;
  text: string;
  createdAt: Date;
}

export type VisitRole = 'CLIENTE' | 'VENDEDOR' | 'AUTOMATICA';

export interface VisitLine {
  messageId: string;
  role: VisitRole;
  text: string;
  createdAt: Date;
}

export interface VisitMetrics {
  firstHumanReplyMinutes: number | null;
  humanMessages: number;
  followUps: number;
  firstFollowUpHours: number | null;
  proposalSent: boolean;
  lastShopperMessageAt: string | null;
}

export interface VisitCriterion {
  name: string;
  description: string;
  instructions: string;
}

export interface CriterionScore {
  criterion: string;
  label: string;
  score: Score | null;
  evidence: string;
  comment: string;
  measuredBy: 'CODE' | 'AI';
}

export interface VisitSummary {
  summary: string;
  strengths: string[];
  improvements: string[];
}

export interface VisitEvaluation {
  scores: CriterionScore[];
  summary: VisitSummary;
}

export interface EvaluationResult {
  sellerUserId: string | null;
  sellerName: string | null;
  metrics: VisitMetrics;
  scores: CriterionScore[];
  totalScore: number | null;
  summary: VisitSummary;
  costUsd: number;
}

export interface MysteryShopperSettings {
  viewerEmails: string[];
  telegramChatIds: string[];
}
