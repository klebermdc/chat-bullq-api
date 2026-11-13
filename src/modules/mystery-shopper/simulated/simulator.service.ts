import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt, randomUUID } from 'crypto';
import { Queue } from 'bullmq';
import { messageText } from '../../messaging/messages/message-search';
import { MysteryShopperRepository, type NumberRow, type SimulatorMessageRow } from '../mystery-shopper.repository';

export const SIMULATOR_MAX_MESSAGES = 200;
const MAX_PHONE_ATTEMPTS = 5;
// DDI 55 + DDD 25 + 9. O DDD 25 não existe no plano de numeração brasileiro: o número
// simulado nunca colide com um cliente real (nem com a carteira importada).
const PHONE_PREFIX = '55259';
const LOCAL_LENGTH = 8;

/** Celular falso em DDD inexistente: 55 25 9 + 8 dígitos (o primeiro 6-9, como no plano de numeração real). */
export function generateSimulatedPhone(): string {
  let local = String(randomInt(6, 10));
  for (let i = 1; i < LOCAL_LENGTH; i++) local += String(randomInt(0, 10));
  return PHONE_PREFIX + local;
}

/** Tique do ponto de vista do cliente. */
export function toSimulatorStatus(message: { direction: string; status: string }, hasLaterOutbound: boolean): string {
  if (message.direction === 'OUTBOUND') return message.status.toLowerCase();
  return hasLaterOutbound ? 'read' : 'delivered';
}

export interface SimulatorMessage {
  id: string;
  from: 'CLIENTE' | 'EMPRESA';
  text: string;
  createdAt: Date;
  status: string;
}

export interface SimulatorConversation {
  number: { id: string; label: string; phone: string; profileName: string | null };
  conversationId: string | null;
  messages: SimulatorMessage[];
}

/** Cliente simulado do cliente oculto: cria o número falso e conversa como cliente pela fila de entrada. */
@Injectable()
export class SimulatorService {
  constructor(
    private readonly repository: MysteryShopperRepository,
    @InjectQueue('inbound-messages') private readonly inboundQueue: Queue,
  ) {}

  listChannels(organizationId: string): Promise<Array<{ id: string; name: string }>> {
    return this.repository.findOfficialChannels(organizationId);
  }

  async createNumber(
    organizationId: string,
    input: { label: string; profileName?: string; channelId: string },
    userId: string,
  ): Promise<NumberRow> {
    const channel = await this.repository.findActiveOfficialChannel(organizationId, input.channelId);
    if (!channel) throw new BadRequestException('Canal inválido: escolha um canal WhatsApp oficial ativo.');
    const label = input.label.trim();
    const profileName = input.profileName?.trim() || null;
    for (let attempt = 0; attempt < MAX_PHONE_ATTEMPTS; attempt++) {
      const row = await this.repository.createSimulatedNumber(organizationId, {
        phone: generateSimulatedPhone(),
        label,
        profileName,
        channelId: channel.id,
        userId,
      });
      if (row) return row;
    }
    throw new ConflictException('Não foi possível gerar um número livre. Tente de novo.');
  }

  async sendMessage(
    organizationId: string,
    numberId: string,
    text: string,
  ): Promise<{ queued: true; externalMessageId: string }> {
    const number = await this.requireSimulated(organizationId, numberId);
    const body = text.trim();
    if (!body) throw new BadRequestException('Escreva uma mensagem.');
    const phone = number.contact.phone as string;
    const externalMessageId = `sim.in.${randomUUID().replace(/-/g, '')}`;
    // Mesmo formato e opções do webhook-gateway: o resto do fluxo não sabe que é simulado.
    await this.inboundQueue.add(
      'process-inbound',
      {
        channelId: number.channel.id,
        organizationId,
        message: {
          externalMessageId,
          externalContactId: phone,
          contactPhone: phone,
          contactName: number.profileName ?? undefined,
          channelType: number.channel.type,
          timestamp: new Date(),
          type: 'TEXT',
          content: { text: body },
          rawPayload: { simulated: true },
        },
      },
      { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true, removeOnFail: false },
    );
    return { queued: true, externalMessageId };
  }

  async getConversation(organizationId: string, numberId: string): Promise<SimulatorConversation> {
    const number = await this.requireSimulated(organizationId, numberId);
    const { conversationId, messages } = await this.repository.findSimulatorMessages(
      number.contactId,
      number.channel.id,
      SIMULATOR_MAX_MESSAGES,
    );
    return {
      number: { id: number.id, label: number.label, phone: number.contact.phone as string, profileName: number.profileName },
      conversationId,
      messages: toSimulatorMessages(messages),
    };
  }

  /** 404 = não existe/outra org/removido; 400 = existe mas é chip real (ou sem canal). */
  private async requireSimulated(organizationId: string, numberId: string) {
    const number = await this.repository.findNumberForSimulator(organizationId, numberId);
    if (!number) throw new NotFoundException();
    if (!number.isSimulated || !number.channel || !number.contact.phone) {
      throw new BadRequestException('Este número não é um cliente simulado.');
    }
    return { ...number, channel: number.channel, contact: number.contact };
  }
}

function toSimulatorMessages(rows: SimulatorMessageRow[]): SimulatorMessage[] {
  // Do fim para o começo: guarda se já vimos uma mensagem da empresa depois.
  let laterOutbound = false;
  const out: SimulatorMessage[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    out.push({
      id: row.id,
      from: row.direction === 'INBOUND' ? 'CLIENTE' : 'EMPRESA',
      text: messageText(row.content),
      createdAt: row.createdAt,
      status: toSimulatorStatus(row, laterOutbound),
    });
    if (row.direction === 'OUTBOUND') laterOutbound = true;
  }
  return out.reverse();
}
