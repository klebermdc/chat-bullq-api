import { EventEmitter } from 'node:events';

/**
 * Ligação de saída: o participante SIP entra na sala ainda "chamando".
 * Só cumprimenta quando o atributo sip.callStatus vira "active" (atendeu).
 * Participante comum (navegador) ou SIP já ativo: segue na hora.
 */
export const SIP_CALL_STATUS = 'sip.callStatus';
const ACTIVE = 'active';
const ENDED = new Set(['hangup', 'disconnected']);

export interface ParticipantLike {
  identity: string;
  attributes: Record<string, string>;
}

/** O que precisamos da sala (Room do rtc-node é um EventEmitter). */
export type RoomLike = Pick<EventEmitter, 'on' | 'off'>;

export function waitUntilAnswered(room: RoomLike, participant: ParticipantLike, timeoutMs: number): Promise<boolean> {
  const status = participant.attributes[SIP_CALL_STATUS];
  if (status === undefined || status === ACTIVE) return Promise.resolve(true);
  if (ENDED.has(status)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const done = (answered: boolean) => {
      clearTimeout(timer);
      room.off('participantAttributesChanged', onAttrs);
      room.off('participantDisconnected', onLeft);
      resolve(answered);
    };
    const onAttrs = (changed: Record<string, string>, p: ParticipantLike) => {
      if (p.identity !== participant.identity) return;
      const next = changed[SIP_CALL_STATUS];
      if (next === ACTIVE) done(true);
      else if (next && ENDED.has(next)) done(false);
    };
    const onLeft = (p: ParticipantLike) => {
      if (p.identity === participant.identity) done(false);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    room.on('participantAttributesChanged', onAttrs);
    room.on('participantDisconnected', onLeft);
  });
}
