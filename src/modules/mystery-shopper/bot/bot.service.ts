import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { MysteryShopperBotStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { MYSTERY_SHOPPER_QUEUE } from '../mystery-shopper.constants';
import { MysteryShopperRepository } from '../mystery-shopper.repository';
import { SimulatorService } from '../simulated/simulator.service';
import { BOT_OPENING_MESSAGE, botTurnJobId } from './bot.constants';
import { BotRepository, type BotRunRow } from './bot.repository';

export interface BotState {
  status: MysteryShopperBotStatus;
  persona: string;
  clientMessages: number;
  lastError: string | null;
}

export function toBotState(run: BotRunRow | null): BotState | null {
  if (!run) return null;
  return { status: run.status, persona: run.persona, clientMessages: run.clientMessages, lastError: run.lastError };
}

/** Iniciar, parar e consultar o robô que faz o papel do cliente simulado. */
@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(
    private readonly numbers: MysteryShopperRepository,
    private readonly repository: BotRepository,
    private readonly simulator: SimulatorService,
    @InjectQueue(MYSTERY_SHOPPER_QUEUE) private readonly queue: Queue,
  ) {}

  async start(organizationId: string, numberId: string, persona: string): Promise<BotState> {
    await this.requireSimulated(organizationId, numberId);
    if (await this.repository.findActiveRun(organizationId, numberId)) {
      throw new ConflictException('Já existe um robô conversando neste número.');
    }
    const run = await this.repository.createRun(organizationId, numberId, persona.trim());
    try {
      // Mesmo caminho do viewer digitando: SimulatorService → process-inbound.
      await this.simulator.sendMessage(organizationId, numberId, BOT_OPENING_MESSAGE);
    } catch (err) {
      await this.repository.failRun(run.id, (err as Error).message);
      throw err;
    }
    return toBotState(run) as BotState;
  }

  async stop(organizationId: string, numberId: string): Promise<BotState | null> {
    await this.requireSimulated(organizationId, numberId);
    const active = await this.repository.findActiveRun(organizationId, numberId);
    if (!active) return this.getState(organizationId, numberId);
    const stopped = await this.repository.stopRun(active.id);
    await this.removePendingTurn(active.id);
    return toBotState(stopped);
  }

  async getState(organizationId: string, numberId: string): Promise<BotState | null> {
    return toBotState(await this.repository.findLatestRun(organizationId, numberId));
  }

  private async removePendingTurn(runId: string): Promise<void> {
    try {
      const job = await this.queue.getJob(botTurnJobId(runId));
      await job?.remove();
    } catch (err) {
      // Turno em execução não pode ser removido: ele relê o status antes de enviar.
      this.logger.warn(`bot_turn_remove_failed run=${runId}: ${(err as Error).message}`);
    }
  }

  /** 404 = não existe/outra org/removido; 400 = existe mas é chip real (ou sem canal). */
  private async requireSimulated(organizationId: string, numberId: string): Promise<void> {
    const number = await this.numbers.findNumberForSimulator(organizationId, numberId);
    if (!number) throw new NotFoundException();
    if (!number.isSimulated || !number.channel || !number.contact.phone) {
      throw new BadRequestException('Este número não é um cliente simulado.');
    }
  }
}
