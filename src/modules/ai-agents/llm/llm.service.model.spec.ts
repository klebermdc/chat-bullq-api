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

function resolve(
  svc: LlmService,
  providerModel: string | undefined,
  agentModelId: string,
  hasImage = false,
) {
  return (svc as any).resolveEffectiveModel(providerModel, agentModelId, hasImage);
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

/**
 * Pedido com imagem (print de orçamento, voucher): o modelo de texto da chave
 * (ex.: MiniMax-M2) não enxerga imagem e inventa os dados. Com imagem, troca
 * para o modelo de visão da MiniMax (M3), na mesma chave.
 */
describe('LlmService.resolveEffectiveModel com imagem', () => {
  it('troca o model da chave pelo modelo de visão padrão (MiniMax-M3)', () => {
    const svc = make();
    expect(resolve(svc, 'MiniMax-M2', 'sakana/fugu', true)).toBe('MiniMax-M3');
  });

  it('respeita LLM_VISION_MODEL quando configurado', () => {
    const config = {
      get: (k: string) => (k === 'LLM_VISION_MODEL' ? 'MiniMax-M3-Pro' : undefined),
    } as any;
    const svc = new LlmService(config, { resolve: jest.fn() } as any);
    expect(resolve(svc, 'MiniMax-M2', 'sakana/fugu', true)).toBe('MiniMax-M3-Pro');
  });

  it('sem imagem, mantém o model da chave', () => {
    const svc = make();
    expect(resolve(svc, 'MiniMax-M2', 'sakana/fugu', false)).toBe('MiniMax-M2');
  });

  it('sem model na chave (caminho Sakana), não troca', () => {
    const svc = make();
    expect(resolve(svc, undefined, 'sakana/fugu', true)).toBe('fugu');
  });
});

describe('LlmService.hasImage', () => {
  const hasImage = (messages: unknown) => (make() as any).hasImage(messages);

  it('detecta parte de imagem no conteúdo do usuário', () => {
    expect(
      hasImage([
        { role: 'system', content: 'x' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'leia' },
            { type: 'image', base64: { mediaType: 'image/png', data: 'AAA' } },
          ],
        },
      ]),
    ).toBe(true);
  });

  it('só texto não conta como imagem', () => {
    expect(hasImage([{ role: 'user', content: 'oi' }])).toBe(false);
    expect(hasImage([{ role: 'user', content: [{ type: 'text', text: 'oi' }] }])).toBe(false);
  });
});
