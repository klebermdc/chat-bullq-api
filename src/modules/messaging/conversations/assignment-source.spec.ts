import { deriveAssignmentSource } from './assignment-source';

describe('deriveAssignmentSource', () => {
  it('de outro vendedor para este é transferência', () => {
    expect(deriveAssignmentSource({ fromValue: 'u-a', toValue: 'u-b', actorId: 'gestor' })).toBe('transfer');
  });

  it('transferência vale mesmo quando o próprio vendedor puxa de outro', () => {
    expect(deriveAssignmentSource({ fromValue: 'u-a', toValue: 'u-b', actorId: 'u-b' })).toBe('transfer');
  });

  it('vendedor pegando cliente da fila para si é self', () => {
    expect(deriveAssignmentSource({ fromValue: null, toValue: 'u-b', actorId: 'u-b' })).toBe('self');
  });

  it('alguém entregando cliente da fila a um vendedor é distribuição', () => {
    expect(deriveAssignmentSource({ fromValue: null, toValue: 'u-b', actorId: 'gestor' })).toBe('distribution');
  });
});
