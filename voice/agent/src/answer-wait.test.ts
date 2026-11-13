import { EventEmitter } from 'node:events';
import { describe, expect, test } from 'vitest';
import { waitUntilAnswered } from './answer-wait.js';

const p = (status?: string) => ({ identity: 'cliente', attributes: status ? { 'sip.callStatus': status } : {} });

describe('waitUntilAnswered', () => {
  test('participante do navegador (sem SIP) ou já ativo: segue na hora', async () => {
    await expect(waitUntilAnswered(new EventEmitter(), p(), 50)).resolves.toBe(true);
    await expect(waitUntilAnswered(new EventEmitter(), p('active'), 50)).resolves.toBe(true);
  });

  test('chamando: espera virar active', async () => {
    const room = new EventEmitter();
    const r = waitUntilAnswered(room, p('dialing'), 1000);
    room.emit('participantAttributesChanged', { 'sip.callStatus': 'ringing' }, p('ringing'));
    room.emit('participantAttributesChanged', { 'sip.callStatus': 'active' }, p('active'));
    await expect(r).resolves.toBe(true);
    expect(room.listenerCount('participantAttributesChanged')).toBe(0);
  });

  test('desligou, saiu da sala ou ninguém atendeu: não cumprimenta', async () => {
    const a = new EventEmitter();
    const r1 = waitUntilAnswered(a, p('dialing'), 1000);
    a.emit('participantAttributesChanged', { 'sip.callStatus': 'hangup' }, p('hangup'));
    await expect(r1).resolves.toBe(false);
    const b = new EventEmitter();
    const r2 = waitUntilAnswered(b, p('ringing'), 1000);
    b.emit('participantDisconnected', p());
    await expect(r2).resolves.toBe(false);
    await expect(waitUntilAnswered(new EventEmitter(), p('ringing'), 20)).resolves.toBe(false);
  });

  test('ignora mudanças de outro participante', async () => {
    const room = new EventEmitter();
    const r = waitUntilAnswered(room, p('dialing'), 50);
    room.emit('participantAttributesChanged', { 'sip.callStatus': 'active' }, { identity: 'outro', attributes: {} });
    await expect(r).resolves.toBe(false);
  });
});
