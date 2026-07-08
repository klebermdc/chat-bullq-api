import { ResponseClassifierService } from './response-classifier.service';

/** Fake LlmService — só o `complete` importa para o classificador. */
function makeLlm(impl?: jest.Mock) {
  return { complete: impl ?? jest.fn() } as any;
}

function msg(overrides: any = {}) {
  return {
    organizationId: 'org1',
    content: { text: '' },
    metadata: {},
    ...overrides,
  };
}

const STEP_SIM_NAO = { options: ['SIM', 'NAO'] } as any;
const STEP_FULL = { options: ['SIM', 'NAO', 'DESCADASTRAR'] } as any;

describe('ResponseClassifierService', () => {
  describe('botão nativo', () => {
    it('metadata.buttonId=SIM → SIM (sem consultar o LLM)', async () => {
      const llm = makeLlm();
      const svc = new ResponseClassifierService(llm);
      const out = await svc.classify(
        msg({ metadata: { buttonId: 'SIM' }, content: { text: 'qualquer coisa' } }),
        STEP_FULL,
      );
      expect(out).toBe('SIM');
      expect(llm.complete).not.toHaveBeenCalled();
    });

    it('metadata.buttonId=DESCADASTRAR → DESCADASTRAR', async () => {
      const svc = new ResponseClassifierService(makeLlm());
      expect(
        await svc.classify(msg({ metadata: { buttonId: 'DESCADASTRAR' } }), STEP_FULL),
      ).toBe('DESCADASTRAR');
    });
  });

  describe('número / palavra-chave (texto normalizado)', () => {
    it("'1' → SIM", async () => {
      const svc = new ResponseClassifierService(makeLlm());
      expect(await svc.classify(msg({ content: { text: '1' } }), STEP_SIM_NAO)).toBe('SIM');
    });

    it("'2' → NAO", async () => {
      const svc = new ResponseClassifierService(makeLlm());
      expect(await svc.classify(msg({ content: { text: '2' } }), STEP_SIM_NAO)).toBe('NAO');
    });

    it("'3' → DESCADASTRAR", async () => {
      const svc = new ResponseClassifierService(makeLlm());
      expect(await svc.classify(msg({ content: { text: '3' } }), STEP_FULL)).toBe(
        'DESCADASTRAR',
      );
    });

    it("'Quero!' → SIM (ignora pontuação/caixa)", async () => {
      const svc = new ResponseClassifierService(makeLlm());
      expect(await svc.classify(msg({ content: { text: 'Quero!' } }), STEP_SIM_NAO)).toBe(
        'SIM',
      );
    });

    it("'sim' → SIM (token único de palavra-chave)", async () => {
      const llm = makeLlm();
      const svc = new ResponseClassifierService(llm);
      expect(await svc.classify(msg({ content: { text: 'sim' } }), STEP_SIM_NAO)).toBe(
        'SIM',
      );
      expect(llm.complete).not.toHaveBeenCalled();
    });

    it("'Não' → NAO (token único, normaliza acento)", async () => {
      const llm = makeLlm();
      const svc = new ResponseClassifierService(llm);
      expect(
        await svc.classify(msg({ content: { text: 'Não' } }), STEP_SIM_NAO),
      ).toBe('NAO');
      expect(llm.complete).not.toHaveBeenCalled();
    });

    it("'sair' → DESCADASTRAR", async () => {
      const svc = new ResponseClassifierService(makeLlm());
      expect(await svc.classify(msg({ content: { text: 'sair' } }), STEP_FULL)).toBe(
        'DESCADASTRAR',
      );
    });
  });

  // FIX 2: um dígito/palavra-chave no MEIO de uma frase NÃO pode disparar o
  // ramo numérico/keyword — deve cair para o LLM (aqui não mockado → AMBIGUO).
  describe('false-positives — dígito/keyword dentro de frase (não casa)', () => {
    it("'somos 3 pessoas' → NÃO vira DESCADASTRAR (vai ao LLM → AMBIGUO)", async () => {
      const complete = jest.fn().mockResolvedValue({ message: { content: '' } });
      const svc = new ResponseClassifierService(makeLlm(complete));
      const out = await svc.classify(
        msg({ content: { text: 'somos 3 pessoas' } }),
        STEP_FULL,
      );
      expect(out).not.toBe('DESCADASTRAR');
      expect(out).toBe('AMBIGUO');
      expect(complete).toHaveBeenCalledTimes(1);
    });

    it("'nao sei, pode ser 2 pessoas' → NÃO vira NAO (vai ao LLM → AMBIGUO)", async () => {
      const complete = jest.fn().mockResolvedValue({ message: { content: '' } });
      const svc = new ResponseClassifierService(makeLlm(complete));
      const out = await svc.classify(
        msg({ content: { text: 'nao sei, pode ser 2 pessoas' } }),
        STEP_SIM_NAO,
      );
      expect(out).not.toBe('NAO');
      expect(out).not.toBe('DESCADASTRAR');
      expect(out).toBe('AMBIGUO');
      expect(complete).toHaveBeenCalledTimes(1);
    });

    it("'quero saber o preço para 1 diária' → texto → LLM (não SIM automático)", async () => {
      const complete = jest.fn().mockResolvedValue({ message: { content: '' } });
      const svc = new ResponseClassifierService(makeLlm(complete));
      const out = await svc.classify(
        msg({ content: { text: 'quero saber o preço para 1 diária' } }),
        STEP_SIM_NAO,
      );
      expect(out).toBe('AMBIGUO');
      expect(complete).toHaveBeenCalledTimes(1);
    });
  });

  describe('fallback LLM', () => {
    it('texto fora do padrão → usa LLM; retorno NAO → NAO', async () => {
      const complete = jest
        .fn()
        .mockResolvedValue({ message: { content: 'NAO' } });
      const svc = new ResponseClassifierService(makeLlm(complete));
      const out = await svc.classify(
        msg({ content: { text: 'acho que agora esta meio complicado pra mim' } }),
        STEP_SIM_NAO,
      );
      expect(out).toBe('NAO');
      expect(complete).toHaveBeenCalledTimes(1);
    });

    it('LLM lança → AMBIGUO', async () => {
      const complete = jest.fn().mockRejectedValue(new Error('no key'));
      const svc = new ResponseClassifierService(makeLlm(complete));
      const out = await svc.classify(
        msg({ content: { text: 'humm deixa eu ver com meu marido depois' } }),
        STEP_SIM_NAO,
      );
      expect(out).toBe('AMBIGUO');
    });

    it('sem organizationId → não chama LLM → AMBIGUO', async () => {
      const complete = jest.fn();
      const svc = new ResponseClassifierService(makeLlm(complete));
      const out = await svc.classify(
        msg({ organizationId: undefined, content: { text: 'talvez semana que vem' } }),
        STEP_SIM_NAO,
      );
      expect(out).toBe('AMBIGUO');
      expect(complete).not.toHaveBeenCalled();
    });

    it('LLM retorna algo irreconhecível → AMBIGUO', async () => {
      const complete = jest
        .fn()
        .mockResolvedValue({ message: { content: 'sei lá' } });
      const svc = new ResponseClassifierService(makeLlm(complete));
      const out = await svc.classify(
        msg({ content: { text: 'blá blá blá' } }),
        STEP_SIM_NAO,
      );
      expect(out).toBe('AMBIGUO');
    });
  });
});
