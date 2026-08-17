import { AutomationTrigger } from '@prisma/client';
import {
  ConditionsEvaluator,
  ConditionRoot,
  FIELDS_BY_TRIGGER,
} from './conditions-evaluator';
import { MessageReceivedPayload } from '../automations.types';

describe('FIELDS_BY_TRIGGER', () => {
  const messageFields = () => FIELDS_BY_TRIGGER[AutomationTrigger.MESSAGE_RECEIVED];

  it('expoe storyKind para MESSAGE_RECEIVED', () => {
    expect(messageFields().storyKind).toBeDefined();
  });

  it('le storyKind do payload', () => {
    const payload = { storyKind: 'reply' } as any;
    expect(messageFields().storyKind(payload)).toBe('reply');
  });

  it('devolve null quando o payload nao tem storyKind', () => {
    const payload = { body: 'oi' } as any;
    expect(messageFields().storyKind(payload)).toBeNull();
  });

  it('devolve null quando storyKind ja vem null no payload', () => {
    const payload = { storyKind: null } as any;
    expect(messageFields().storyKind(payload)).toBeNull();
  });

  it('le storyKind = mention do payload', () => {
    const payload = { storyKind: 'mention' } as any;
    expect(messageFields().storyKind(payload)).toBe('mention');
  });

  it('mantem os campos que ja existiam', () => {
    const f = messageFields();
    expect(f.body).toBeDefined();
    expect(f.type).toBeDefined();
    expect(f.hasAttachment).toBeDefined();
    expect(f.channelId).toBeDefined();
    expect(f.contactId).toBeDefined();
    expect(f.conversationId).toBeDefined();
  });

  it('nao expoe storyKind para outros gatilhos (ex: TAG_ADDED)', () => {
    const tagFields = FIELDS_BY_TRIGGER[AutomationTrigger.TAG_ADDED];
    expect(tagFields.storyKind).toBeUndefined();
  });
});

describe('ConditionsEvaluator — storyKind end-to-end', () => {
  const evaluator = new ConditionsEvaluator();

  function basePayload(
    overrides: Partial<MessageReceivedPayload> = {},
  ): MessageReceivedPayload {
    return {
      organizationId: 'org1',
      contactId: 'contact1',
      conversationId: 'conv1',
      channelId: 'chan1',
      messageId: 'msg1',
      body: 'oi',
      type: 'TEXT',
      hasAttachment: false,
      storyKind: null,
      isFromCustomer: true,
      ...overrides,
    };
  }

  function equalsStoryKindReply(): ConditionRoot {
    return {
      match: 'AND',
      groups: [
        {
          match: 'AND',
          rules: [{ field: 'storyKind', op: 'equals', value: 'reply' }],
        },
      ],
    };
  }

  it('casa quando storyKind do payload é reply', () => {
    const result = evaluator.evaluate(
      AutomationTrigger.MESSAGE_RECEIVED,
      equalsStoryKindReply(),
      basePayload({ storyKind: 'reply' }),
    );
    expect(result).toBe(true);
  });

  it('nao casa quando storyKind do payload é null', () => {
    const result = evaluator.evaluate(
      AutomationTrigger.MESSAGE_RECEIVED,
      equalsStoryKindReply(),
      basePayload({ storyKind: null }),
    );
    expect(result).toBe(false);
  });

  it('nao casa quando storyKind do payload é mention (op equals reply)', () => {
    const result = evaluator.evaluate(
      AutomationTrigger.MESSAGE_RECEIVED,
      equalsStoryKindReply(),
      basePayload({ storyKind: 'mention' }),
    );
    expect(result).toBe(false);
  });

  // Este é o cenário que justifica o `?? null` na linha de produção:
  // outbox antigo, gravado antes deste deploy, não tem a chave storyKind
  // no payload serializado (não é `storyKind: null`, é ausência da chave).
  // Sem a normalização, o acessor devolveria `undefined` e `undefined ===
  // null` é `false` — a regra deixaria de casar em silêncio.
  it('equals:null casa quando o payload nao tem a chave storyKind (outbox antigo)', () => {
    const { storyKind, ...legacyPayload } = basePayload();
    const condition: ConditionRoot = {
      match: 'AND',
      groups: [
        {
          match: 'AND',
          rules: [{ field: 'storyKind', op: 'equals', value: null }],
        },
      ],
    };
    const result = evaluator.evaluate(
      AutomationTrigger.MESSAGE_RECEIVED,
      condition,
      legacyPayload as any,
    );
    expect(result).toBe(true);
  });

  it('not_equals:reply casa quando storyKind é null', () => {
    const condition: ConditionRoot = {
      match: 'AND',
      groups: [
        {
          match: 'AND',
          rules: [{ field: 'storyKind', op: 'not_equals', value: 'reply' }],
        },
      ],
    };
    const result = evaluator.evaluate(
      AutomationTrigger.MESSAGE_RECEIVED,
      condition,
      basePayload({ storyKind: null }),
    );
    expect(result).toBe(true);
  });

  it('not_equals:reply nao casa quando storyKind é reply', () => {
    const condition: ConditionRoot = {
      match: 'AND',
      groups: [
        {
          match: 'AND',
          rules: [{ field: 'storyKind', op: 'not_equals', value: 'reply' }],
        },
      ],
    };
    const result = evaluator.evaluate(
      AutomationTrigger.MESSAGE_RECEIVED,
      condition,
      basePayload({ storyKind: 'reply' }),
    );
    expect(result).toBe(false);
  });

  // Documenta comportamento, não prescreve: `applyOperator` faz
  // `typeof actual !== 'string'` antes de `contains`/`not_contains`.
  // storyKind é `'reply' | 'mention' | null` — mesmo quando é string,
  // ele passa no typeof check e o `contains` normal roda. Só falha o
  // "fast path" quando storyKind é null (não é string). Registrado para
  // quem for montar a UI de condições não presumir paridade com `body`.
  it('contains casa normalmente quando storyKind é uma string (ex: reply)', () => {
    const condition: ConditionRoot = {
      match: 'AND',
      groups: [
        {
          match: 'AND',
          rules: [{ field: 'storyKind', op: 'contains', value: 'epl' }],
        },
      ],
    };
    const result = evaluator.evaluate(
      AutomationTrigger.MESSAGE_RECEIVED,
      condition,
      basePayload({ storyKind: 'reply' }),
    );
    expect(result).toBe(true);
  });

  it('contains nunca casa quando storyKind é null (falha o typeof check)', () => {
    const condition: ConditionRoot = {
      match: 'AND',
      groups: [
        {
          match: 'AND',
          rules: [{ field: 'storyKind', op: 'contains', value: 'reply' }],
        },
      ],
    };
    const result = evaluator.evaluate(
      AutomationTrigger.MESSAGE_RECEIVED,
      condition,
      basePayload({ storyKind: null }),
    );
    expect(result).toBe(false);
  });

  it('not_contains sempre casa quando storyKind é null (fail-open do typeof check)', () => {
    const condition: ConditionRoot = {
      match: 'AND',
      groups: [
        {
          match: 'AND',
          rules: [{ field: 'storyKind', op: 'not_contains', value: 'reply' }],
        },
      ],
    };
    const result = evaluator.evaluate(
      AutomationTrigger.MESSAGE_RECEIVED,
      condition,
      basePayload({ storyKind: null }),
    );
    expect(result).toBe(true);
  });

  it('is_not_set casa quando storyKind é null', () => {
    const condition: ConditionRoot = {
      match: 'AND',
      groups: [
        {
          match: 'AND',
          rules: [{ field: 'storyKind', op: 'is_not_set', value: undefined }],
        },
      ],
    };
    const result = evaluator.evaluate(
      AutomationTrigger.MESSAGE_RECEIVED,
      condition,
      basePayload({ storyKind: null }),
    );
    expect(result).toBe(true);
  });

  it('is_set casa quando storyKind é mention', () => {
    const condition: ConditionRoot = {
      match: 'AND',
      groups: [
        {
          match: 'AND',
          rules: [{ field: 'storyKind', op: 'is_set', value: undefined }],
        },
      ],
    };
    const result = evaluator.evaluate(
      AutomationTrigger.MESSAGE_RECEIVED,
      condition,
      basePayload({ storyKind: 'mention' }),
    );
    expect(result).toBe(true);
  });
});
