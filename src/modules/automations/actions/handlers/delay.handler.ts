import { Injectable } from '@nestjs/common';
import {
  ActionContext,
  ActionExecutionResult,
  ActionHandler,
} from '../action.types';

type DelayUnit = 'minutes' | 'hours' | 'days';

interface DelayParams {
  unit: DelayUnit;
  value: number;
}

const UNIT_MS: Record<DelayUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

// Ação de controle de fluxo: pausa o run por um tempo relativo. Não toca
// DB nem outbox — apenas calcula `resumeAt` e devolve o sinal. Toda a
// durabilidade (persistir WAITING, re-enfileirar) é do executor + watchdog.
@Injectable()
export class DelayHandler implements ActionHandler {
  readonly type = 'delay' as const;
  // Irrelevante para delay (nunca "falha" no sentido de continueOnError),
  // mas o contrato ActionHandler exige o campo.
  readonly continueOnErrorDefault = false;

  validateParams(params: Record<string, unknown>): void {
    const p = params as Partial<DelayParams>;
    if (p.unit !== 'minutes' && p.unit !== 'hours' && p.unit !== 'days') {
      throw new Error('delay: "unit" deve ser "minutes" | "hours" | "days"');
    }
    if (
      typeof p.value !== 'number' ||
      !Number.isInteger(p.value) ||
      p.value <= 0
    ) {
      throw new Error('delay: "value" deve ser inteiro > 0');
    }
  }

  async execute(
    params: Record<string, unknown>,
    _ctx: ActionContext,
  ): Promise<ActionExecutionResult> {
    const p = params as unknown as DelayParams;
    const ms = UNIT_MS[p.unit] * p.value;
    const resumeAt = new Date(Date.now() + ms).toISOString();
    return {
      ok: true,
      control: { type: 'delay', resumeAt },
      output: { unit: p.unit, value: p.value, resumeAt },
    };
  }
}
