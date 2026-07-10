import { BadRequestException } from '@nestjs/common';
import { LlmService } from './llm.service';

/**
 * Resolução do modelo efetivo: a chave de provedor da org pode fixar um `model`
 * (ex.: MiniMax) que deve valer como está, sem a restrição Sakana. Sem `model`
 * na chave, mantém o caminho Sakana (normaliza fugu/sakana e rejeita o resto).
 */
function make(): LlmService {
  const config = { get: () => undefined } as any;
  const providerKeys = { resolve: jest.fn() } as any;
  return new LlmService(config, providerKeys);
}

function resolve(svc: LlmService, providerModel: string | undefined, agentModelId: string) {
  return (svc as any).resolveEffectiveModel(providerModel, agentModelId);
}

describe('LlmService.resolveEffectiveModel', () => {
  it('usa o model da chave de provedor como está (ex.: MiniMax), sem trava Sakana', () => {
    const svc = make();
    expect(resolve(svc, 'MiniMax-M1', 'sakana/fugu')).toBe('MiniMax-M1');
  });

  it('sem model na chave, normaliza o modelId Sakana do agente (fugu-ultra)', () => {
    const svc = make();
    expect(resolve(svc, undefined, 'sakana/fugu-ultra-20260615')).toBe(
      'fugu-ultra-20260615',
    );
  });

  it('sem model na chave, ainda rejeita modelos não-Sakana (ex.: claude)', () => {
    const svc = make();
    expect(() => resolve(svc, undefined, 'claude-sonnet-4')).toThrow(
      BadRequestException,
    );
  });

  it('model da chave em branco cai no caminho Sakana', () => {
    const svc = make();
    expect(resolve(svc, '   ', 'sakana/fugu')).toBe('fugu');
  });
});
