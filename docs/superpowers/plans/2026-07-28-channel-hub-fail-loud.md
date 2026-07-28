# Fail-loud no channel-hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nenhum webhook de cliente pode ser descartado em silêncio — todo descarte vira linha auditável em `webhook_events` e, quando dá pra identificar a organização, alerta o OWNER dentro do app.

**Architecture:** Um serviço novo (`InboundDropReporter`) concentra os quatro caminhos de descarte do `WebhookGatewayController`. Ele persiste via `WebhookEventsService`, aplica throttle com `SET NX EX` no Redis e alerta via `notifyOrgAgents({ roles: [OWNER] })`. Em paralelo, `resolveByLocator` passa a enxergar canais inativos para distinguir "canal desativado" de "canal inexistente".

**Tech Stack:** NestJS 10, Prisma 6, ioredis, Jest (ts-jest). Spec: [`docs/superpowers/specs/2026-07-27-channel-hub-fail-loud-design.md`](../specs/2026-07-27-channel-hub-fail-loud-design.md).

**Baseline conhecido:** `npx jest` na base desta branch dá **993/998 passando**. As 5 falhas são de `src/modules/ai-provider-keys/ai-provider-keys.integration.spec.ts`, que exige um Postgres real (`PrismaClientInitializationError`). São pré-existentes e não relacionadas — se aparecerem, ignore. Qualquer outra falha é regressão sua.

**Convenção de testes deste módulo:** nada de `Test.createTestingModule`. Os specs instanciam a classe direto com mocks (`new Service(mockA as any, mockB as any)`) a partir de uma função `build()`. Siga [`message-templates.service.spec.ts`](../../src/modules/channel-hub/message-templates/message-templates.service.spec.ts).

---

### Task 1: `recordDropped` no WebhookEventsService

Hoje `recordUnrouted` não aceita `channelId` nem motivo. Vira `recordDropped`, que grava os dois. O `recordUnrouted` é removido no fim da Task 5, quando seu único chamador some.

**Files:**
- Modify: `src/modules/channel-hub/webhook-events.service.ts`
- Test: `src/modules/channel-hub/webhook-events.service.spec.ts` (criar)

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/modules/channel-hub/webhook-events.service.spec.ts`:

```ts
import { WebhookEventsService } from './webhook-events.service';

const build = () => {
  const prisma = {
    webhookEvent: {
      create: jest.fn().mockResolvedValue({ id: 'evt1' }),
    },
  };
  const service = new WebhookEventsService(prisma as any);
  return { prisma, service };
};

describe('WebhookEventsService.recordDropped', () => {
  it('grava UNROUTED com motivo e channelId', async () => {
    const { prisma, service } = build();

    const id = await service.recordDropped({
      channelType: 'WHATSAPP_OFFICIAL' as any,
      reason: 'CHANNEL_INACTIVE: canal Comercial (ch1)',
      payload: { foo: 'bar' },
      headers: { 'x-hub-signature': 'abc', authorization: 'Bearer segredo' },
      channelId: 'ch1',
    });

    expect(id).toBe('evt1');
    const data = prisma.webhookEvent.create.mock.calls[0][0].data;
    expect(data.status).toBe('UNROUTED');
    expect(data.channelId).toBe('ch1');
    expect(data.errorMessage).toBe('CHANNEL_INACTIVE: canal Comercial (ch1)');
    expect(data.rawPayload).toEqual({ foo: 'bar' });
    // headers sensíveis continuam redigidos
    expect(data.headers.authorization).toBe('[redacted]');
  });

  it('aceita drop sem canal identificado', async () => {
    const { prisma, service } = build();

    await service.recordDropped({
      channelType: 'WHATSAPP_WASENDER' as any,
      reason: 'NO_LOCATORS: canal não identificado',
      payload: {},
      headers: {},
    });

    expect(prisma.webhookEvent.create.mock.calls[0][0].data.channelId).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
npx jest src/modules/channel-hub/webhook-events.service.spec.ts
```

Esperado: FAIL — `service.recordDropped is not a function`.

- [ ] **Step 3: Implementar**

Em `src/modules/channel-hub/webhook-events.service.ts`, adicione logo depois de `recordUnrouted`:

```ts
  /**
   * Registra um inbound descartado. Diferente do recordUnrouted, guarda o
   * motivo em errorMessage e o canal quando ele é conhecido — é o que permite
   * distinguir "canal desativado" de "canal inexistente" no pós-mortem.
   */
  async recordDropped(params: {
    channelType: ChannelType;
    reason: string;
    payload: unknown;
    headers: Record<string, string>;
    channelId?: string | null;
  }): Promise<string> {
    const row = await this.prisma.webhookEvent.create({
      data: {
        channelId: params.channelId ?? null,
        channelType: params.channelType,
        status: WebhookEventStatus.UNROUTED,
        rawPayload: this.safeJson(params.payload),
        headers: this.pickSafeHeaders(params.headers),
        errorMessage: params.reason.slice(0, 2000),
      },
      select: { id: true },
    });
    return row.id;
  }
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
npx jest src/modules/channel-hub/webhook-events.service.spec.ts
```

Esperado: PASS, 2 testes.

- [ ] **Step 5: Commit**

```bash
git add src/modules/channel-hub/webhook-events.service.ts src/modules/channel-hub/webhook-events.service.spec.ts
git commit -m "feat(channel-hub): recordDropped grava motivo e canal do descarte"
```

---

### Task 2: InboundDropReporter — persistência e quem recebe alerta

**Files:**
- Create: `src/modules/channel-hub/inbound-drop-reporter.service.ts`
- Test: `src/modules/channel-hub/inbound-drop-reporter.service.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/modules/channel-hub/inbound-drop-reporter.service.spec.ts`:

```ts
import {
  InboundDropReporter,
  InboundDropReason,
} from './inbound-drop-reporter.service';

const channel = { id: 'ch1', name: 'Comercial', organizationId: 'org1' };

const build = () => {
  const webhookEvents = { recordDropped: jest.fn().mockResolvedValue('evt1') };
  const notifications = { notifyOrgAgents: jest.fn().mockResolvedValue({}) };
  // 'OK' = ganhou o slot de alerta; null = já alertado dentro da janela.
  const redis = { set: jest.fn().mockResolvedValue('OK') };
  const reporter = new InboundDropReporter(
    webhookEvents as any,
    notifications as any,
    redis as any,
  );
  return { webhookEvents, notifications, redis, reporter };
};

const drop = (reason: InboundDropReason, ch: typeof channel | null) => ({
  channelType: 'WHATSAPP_OFFICIAL' as any,
  reason,
  payload: { foo: 'bar' },
  headers: {},
  channel: ch,
});

describe('InboundDropReporter', () => {
  it('sempre persiste o descarte, mesmo sem canal', async () => {
    const { webhookEvents, reporter } = build();

    await reporter.reportDrop(drop(InboundDropReason.NO_LOCATORS, null));

    expect(webhookEvents.recordDropped).toHaveBeenCalledTimes(1);
    const arg = webhookEvents.recordDropped.mock.calls[0][0];
    expect(arg.reason).toContain('NO_LOCATORS');
    expect(arg.channelId).toBeNull();
  });

  it('alerta o OWNER quando o canal está desativado', async () => {
    const { notifications, reporter } = build();

    await reporter.reportDrop(drop(InboundDropReason.CHANNEL_INACTIVE, channel));

    expect(notifications.notifyOrgAgents).toHaveBeenCalledTimes(1);
    const arg = notifications.notifyOrgAgents.mock.calls[0][0];
    expect(arg.organizationId).toBe('org1');
    expect(arg.roles).toEqual(['OWNER']);
    expect(arg.body).toContain('Comercial');
    expect(arg.data).toMatchObject({ channelId: 'ch1', reason: 'CHANNEL_INACTIVE' });
  });

  it('alerta o OWNER quando a assinatura é inválida', async () => {
    const { notifications, reporter } = build();

    await reporter.reportDrop(drop(InboundDropReason.INVALID_SIGNATURE, channel));

    expect(notifications.notifyOrgAgents).toHaveBeenCalledTimes(1);
  });

  it('não alerta quando não há organização identificável', async () => {
    const { notifications, reporter } = build();

    await reporter.reportDrop(drop(InboundDropReason.NO_LOCATORS, null));
    await reporter.reportDrop(drop(InboundDropReason.UNKNOWN_LOCATOR, null));

    expect(notifications.notifyOrgAgents).not.toHaveBeenCalled();
  });

  it('não derruba o webhook se a persistência falhar', async () => {
    const { webhookEvents, notifications, reporter } = build();
    webhookEvents.recordDropped.mockRejectedValue(new Error('prisma fora'));

    await expect(
      reporter.reportDrop(drop(InboundDropReason.CHANNEL_INACTIVE, channel)),
    ).resolves.toBeUndefined();
    // persistir falhou, mas o alerta ainda sai
    expect(notifications.notifyOrgAgents).toHaveBeenCalledTimes(1);
  });

  it('não derruba o webhook se o Redis estiver fora', async () => {
    const { redis, reporter } = build();
    redis.set.mockRejectedValue(new Error('redis fora'));

    await expect(
      reporter.reportDrop(drop(InboundDropReason.CHANNEL_INACTIVE, channel)),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
npx jest src/modules/channel-hub/inbound-drop-reporter.service.spec.ts
```

Esperado: FAIL — não consegue resolver `./inbound-drop-reporter.service`.

- [ ] **Step 3: Implementar**

Crie `src/modules/channel-hub/inbound-drop-reporter.service.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ChannelType, NotificationType, OrgRole } from '@prisma/client';
import type Redis from 'ioredis';
import { WebhookEventsService } from './webhook-events.service';
import { NotificationsService } from '../notifications/notifications.service';

export const INBOUND_DROP_REDIS = 'INBOUND_DROP_REDIS';

export enum InboundDropReason {
  NO_LOCATORS = 'NO_LOCATORS',
  CHANNEL_INACTIVE = 'CHANNEL_INACTIVE',
  UNKNOWN_LOCATOR = 'UNKNOWN_LOCATOR',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
}

export interface DropChannel {
  id: string;
  name: string;
  organizationId: string;
}

/** Um alerta por canal+motivo a cada 15 min. Canal caído gera centenas de
 *  webhooks — sem isso o OWNER receberia centenas de notificações. */
const ALERT_TTL_SECONDS = 15 * 60;

/**
 * Ponto único de relato de inbound descartado.
 *
 * NUNCA lança: uma falha ao relatar um descarte não pode derrubar o webhook e
 * transformar uma mensagem perdida em todas as mensagens perdidas.
 */
@Injectable()
export class InboundDropReporter {
  private readonly logger = new Logger(InboundDropReporter.name);

  constructor(
    private readonly webhookEvents: WebhookEventsService,
    private readonly notifications: NotificationsService,
    @Inject(INBOUND_DROP_REDIS) private readonly redis: Redis,
  ) {}

  async reportDrop(params: {
    channelType: ChannelType;
    reason: InboundDropReason;
    payload: unknown;
    headers: Record<string, string>;
    channel?: DropChannel | null;
  }): Promise<void> {
    const { channelType, reason, payload, headers, channel } = params;
    const context = channel
      ? `canal ${channel.name} (${channel.id})`
      : 'canal não identificado';

    this.logger.warn(`Inbound descartado [${reason}] ${channelType}: ${context}`);

    try {
      await this.webhookEvents.recordDropped({
        channelType,
        reason: `${reason}: ${context}`,
        payload,
        headers,
        channelId: channel?.id ?? null,
      });
    } catch (err: any) {
      this.logger.error(`Falha ao persistir drop ${reason}: ${err.message}`);
    }

    // Sem canal não há organizationId — não existe a quem notificar.
    if (!channel) return;

    const alert = this.buildAlert(reason, channel);
    if (!alert) return;

    try {
      const slot = await this.redis.set(
        `chdrop:${channelType}:${reason}:${channel.id}`,
        '1',
        'EX',
        ALERT_TTL_SECONDS,
        'NX',
      );
      if (slot !== 'OK') return; // já alertado dentro da janela

      await this.notifications.notifyOrgAgents({
        organizationId: channel.organizationId,
        roles: [OrgRole.OWNER],
        type: NotificationType.SYSTEM,
        title: alert.title,
        body: alert.body,
        data: { channelId: channel.id, channelType, reason },
      });
    } catch (err: any) {
      this.logger.error(`Falha ao alertar drop ${reason}: ${err.message}`);
    }
  }

  private buildAlert(
    reason: InboundDropReason,
    channel: DropChannel,
  ): { title: string; body: string } | null {
    switch (reason) {
      case InboundDropReason.CHANNEL_INACTIVE:
        return {
          title: 'Canal desativado está perdendo mensagens',
          body: `O canal "${channel.name}" está desativado e mensagens de clientes estão sendo descartadas. Reative o canal para voltar a receber.`,
        };
      case InboundDropReason.INVALID_SIGNATURE:
        return {
          title: 'Webhook com assinatura inválida',
          body: `O canal "${channel.name}" recebeu um webhook com assinatura inválida e a mensagem foi descartada. Verifique se o token do provedor foi trocado.`,
        };
      default:
        return null;
    }
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
npx jest src/modules/channel-hub/inbound-drop-reporter.service.spec.ts
```

Esperado: PASS, 6 testes.

- [ ] **Step 5: Commit**

```bash
git add src/modules/channel-hub/inbound-drop-reporter.service.ts src/modules/channel-hub/inbound-drop-reporter.service.spec.ts
git commit -m "feat(channel-hub): InboundDropReporter persiste e alerta descartes"
```

---

### Task 3: Throttle do alerta

O serviço já chama `redis.set(...NX)`. Falta o teste que trava o comportamento: dentro da janela, o segundo descarte **não** alerta.

**Files:**
- Test: `src/modules/channel-hub/inbound-drop-reporter.service.spec.ts` (modificar)

- [ ] **Step 1: Escrever o teste que falha**

Adicione ao final do `describe('InboundDropReporter', ...)`:

```ts
  it('só alerta uma vez por canal+motivo dentro da janela', async () => {
    const { redis, notifications, reporter } = build();
    // 1ª chamada ganha o slot, 2ª encontra a chave já gravada
    redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    await reporter.reportDrop(drop(InboundDropReason.CHANNEL_INACTIVE, channel));
    await reporter.reportDrop(drop(InboundDropReason.CHANNEL_INACTIVE, channel));

    expect(notifications.notifyOrgAgents).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      'chdrop:WHATSAPP_OFFICIAL:CHANNEL_INACTIVE:ch1',
      '1',
      'EX',
      900,
      'NX',
    );
  });

  it('persiste os dois descartes mesmo alertando só uma vez', async () => {
    const { redis, webhookEvents, reporter } = build();
    redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    await reporter.reportDrop(drop(InboundDropReason.CHANNEL_INACTIVE, channel));
    await reporter.reportDrop(drop(InboundDropReason.CHANNEL_INACTIVE, channel));

    // throttle é do alerta, não da auditoria
    expect(webhookEvents.recordDropped).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 2: Rodar os testes**

```bash
npx jest src/modules/channel-hub/inbound-drop-reporter.service.spec.ts
```

Esperado: PASS, 8 testes. A implementação da Task 2 já satisfaz esses testes — eles existem para travar o comportamento contra regressão. Se algum falhar, o bug está na Task 2, conserte lá.

- [ ] **Step 3: Commit**

```bash
git add src/modules/channel-hub/inbound-drop-reporter.service.spec.ts
git commit -m "test(channel-hub): trava throttle de alerta por canal+motivo"
```

---

### Task 4: `resolveByLocator` enxerga canal inativo

**Files:**
- Modify: `src/modules/channel-hub/channels/channels.repository.ts`
- Modify: `src/modules/channel-hub/channels/channels.service.ts:403-409`
- Test: `src/modules/channel-hub/channels/channels.service.resolve.spec.ts` (criar)

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/modules/channel-hub/channels/channels.service.resolve.spec.ts`:

```ts
import { ChannelsService } from './channels.service';

const ativo = {
  id: 'ch1',
  name: 'Comercial',
  organizationId: 'org1',
  isActive: true,
  config: { sessionId: 'S1' },
};
const inativo = {
  id: 'ch2',
  name: 'Suporte',
  organizationId: 'org1',
  isActive: false,
  config: { sessionId: 'S2' },
};

const build = (canais: any[]) => {
  const repository = {
    findByTypeIncludingInactive: jest.fn().mockResolvedValue(canais),
  };
  // ChannelsService tem 9 deps no construtor; só a 1ª (repository) é exercitada
  // por resolveByLocator, as outras 8 nunca são tocadas neste teste.
  const service = new ChannelsService(
    repository as any,      // ChannelsRepository
    undefined as any,       // ChannelAdapterRegistry
    undefined as any,       // ZappfyHttpClient
    undefined as any,       // WasenderHttpClient
    undefined as any,       // WhatsAppOfficialHttpClient
    undefined as any,       // InstagramHttpClient
    undefined as any,       // ChannelSyncOrchestrator
    undefined as any,       // PrismaService
    undefined as any,       // ChannelAccessService
  );
  return { repository, service };
};

const bySession = (id: string) => (c: any) => c.config?.sessionId === id;

describe('ChannelsService.resolveByLocator', () => {
  it('devolve o canal com active: true quando está ativo', async () => {
    const { service } = build([ativo, inativo]);

    const res = await service.resolveByLocator('WHATSAPP_WASENDER' as any, bySession('S1'));

    expect(res).toEqual({ channel: ativo, active: true });
  });

  it('devolve o canal com active: false em vez de null quando está desativado', async () => {
    const { service } = build([ativo, inativo]);

    const res = await service.resolveByLocator('WHATSAPP_WASENDER' as any, bySession('S2'));

    // era exatamente isso que sumia antes: canal inativo virava null
    expect(res).toEqual({ channel: inativo, active: false });
  });

  it('devolve null quando nenhum canal casa', async () => {
    const { service } = build([ativo, inativo]);

    const res = await service.resolveByLocator('WHATSAPP_WASENDER' as any, bySession('S9'));

    expect(res).toBeNull();
  });
});
```

A arity acima (9) foi conferida em `channels.service.ts` na base desta branch. Se alguém tiver mexido no construtor no meio-tempo, o `tsc` acusa e basta ajustar a contagem de `undefined as any`.

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
npx jest src/modules/channel-hub/channels/channels.service.resolve.spec.ts
```

Esperado: FAIL — `repository.findByTypeIncludingInactive is not a function`.

- [ ] **Step 3: Adicionar o método no repositório**

Em `src/modules/channel-hub/channels/channels.repository.ts`, logo após `findActiveByType`:

```ts
  /**
   * Inclui canais desativados de propósito: o gateway precisa distinguir
   * "canal desativado" de "canal inexistente" para poder alertar o dono.
   * Canal deletado continua fora — esse é inexistente de fato.
   */
  async findByTypeIncludingInactive(type: ChannelType) {
    return this.prisma.channel.findMany({
      where: { type, deletedAt: null },
    });
  }
```

- [ ] **Step 4: Alterar o `resolveByLocator`**

Em `src/modules/channel-hub/channels/channels.service.ts`, substitua o método inteiro:

```ts
  async resolveByLocator(
    type: ChannelType,
    matches: (channel: { config: any }) => boolean,
  ): Promise<{ channel: Channel; active: boolean } | null> {
    const candidates = await this.repository.findByTypeIncludingInactive(type);
    const found = candidates.find((c) => matches(c));
    return found ? { channel: found, active: found.isActive } : null;
  }
```

`Channel` e `ChannelType` já estão importados no topo do arquivo.

- [ ] **Step 5: Rodar o teste e confirmar que passa**

```bash
npx jest src/modules/channel-hub/channels/channels.service.resolve.spec.ts
```

Esperado: PASS, 3 testes.

- [ ] **Step 6: Confirmar que o compilador achou o chamador desatualizado**

```bash
npx tsc --noEmit
```

Esperado: **FALHA** em `webhook-gateway.controller.ts` — `Property 'id' does not exist on type '{ channel: Channel; active: boolean; }'`. É o esperado nesse ponto; a Task 5 conserta. Se o `tsc` passar limpo aqui, algo está errado — investigue antes de seguir.

- [ ] **Step 7: Commit**

```bash
git add src/modules/channel-hub/channels/channels.repository.ts src/modules/channel-hub/channels/channels.service.ts src/modules/channel-hub/channels/channels.service.resolve.spec.ts
git commit -m "feat(channel-hub): resolveByLocator distingue canal inativo de inexistente"
```

---

### Task 5: Ligar os quatro caminhos de descarte no controller

**Files:**
- Modify: `src/modules/channel-hub/webhook-gateway.controller.ts`
- Modify: `src/modules/channel-hub/webhook-events.service.ts` (remover `recordUnrouted`)
- Test: `src/modules/channel-hub/webhook-gateway.controller.spec.ts` (criar)

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/modules/channel-hub/webhook-gateway.controller.spec.ts`:

```ts
import { WebhookGatewayController } from './webhook-gateway.controller';
import { InboundDropReason } from './inbound-drop-reporter.service';

const ativo = {
  id: 'ch1',
  name: 'Comercial',
  organizationId: 'org1',
  isActive: true,
  webhookSecret: 'segredo',
};
const inativo = {
  id: 'ch2',
  name: 'Suporte',
  organizationId: 'org1',
  isActive: false,
  webhookSecret: 'segredo',
};

const build = () => {
  const adapter = {
    extractLocators: jest.fn().mockReturnValue([{ sessionId: 'S1' }]),
    matchesChannel: jest.fn().mockReturnValue(true),
    validateWebhook: jest.fn().mockReturnValue(true),
    parseWebhook: jest.fn().mockReturnValue({
      messages: [{ externalMessageId: 'm1' }],
      statuses: [],
      templateStatusUpdates: [],
    }),
  };
  const registry = {
    hasAdapter: jest.fn().mockReturnValue(true),
    getInbound: jest.fn().mockReturnValue(adapter),
  };
  const channelsService = {
    resolveByLocator: jest.fn().mockResolvedValue({ channel: ativo, active: true }),
  };
  const webhookEvents = { record: jest.fn().mockResolvedValue('evt1') };
  const dropReporter = { reportDrop: jest.fn().mockResolvedValue(undefined) };
  const inboundQueue = { add: jest.fn().mockResolvedValue({ id: 'j1' }) };
  const templates = { applyStatusUpdate: jest.fn() };

  const controller = new WebhookGatewayController(
    registry as any,
    channelsService as any,
    webhookEvents as any,
    inboundQueue as any,
    templates as any,
    dropReporter as any,
  );

  const res: any = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  const req: any = { headers: {}, body: { foo: 'bar' }, rawBody: Buffer.from('{}') };

  return { adapter, registry, channelsService, webhookEvents, dropReporter, inboundQueue, controller, req, res };
};

describe('WebhookGatewayController — fail loud', () => {
  it('relata NO_LOCATORS quando o payload não tem locator', async () => {
    const { adapter, dropReporter, controller, req, res } = build();
    adapter.extractLocators.mockReturnValue([]);

    await controller.handleWebhook('WHATSAPP_WASENDER' as any, req, res);

    expect(dropReporter.reportDrop).toHaveBeenCalledTimes(1);
    expect(dropReporter.reportDrop.mock.calls[0][0]).toMatchObject({
      reason: InboundDropReason.NO_LOCATORS,
      channel: null,
    });
    expect(res.json).toHaveBeenCalledWith({ status: 'no_locators' });
  });

  it('relata UNKNOWN_LOCATOR quando nenhum canal casa', async () => {
    const { channelsService, dropReporter, controller, req, res } = build();
    channelsService.resolveByLocator.mockResolvedValue(null);

    await controller.handleWebhook('WHATSAPP_WASENDER' as any, req, res);

    expect(dropReporter.reportDrop.mock.calls[0][0]).toMatchObject({
      reason: InboundDropReason.UNKNOWN_LOCATOR,
      channel: null,
    });
    expect(res.json).toHaveBeenCalledWith({ status: 'no_matching_channel' });
  });

  it('relata CHANNEL_INACTIVE e NÃO enfileira quando o canal está desativado', async () => {
    const { channelsService, dropReporter, inboundQueue, controller, req, res } = build();
    channelsService.resolveByLocator.mockResolvedValue({ channel: inativo, active: false });

    await controller.handleWebhook('WHATSAPP_WASENDER' as any, req, res);

    expect(dropReporter.reportDrop.mock.calls[0][0]).toMatchObject({
      reason: InboundDropReason.CHANNEL_INACTIVE,
      channel: inativo,
    });
    expect(inboundQueue.add).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ status: 'no_matching_channel' });
  });

  it('relata INVALID_SIGNATURE e não enfileira quando a assinatura é inválida', async () => {
    const { adapter, dropReporter, inboundQueue, controller, req, res } = build();
    adapter.validateWebhook.mockReturnValue(false);

    await controller.handleWebhook('WHATSAPP_WASENDER' as any, req, res);

    expect(dropReporter.reportDrop.mock.calls[0][0]).toMatchObject({
      reason: InboundDropReason.INVALID_SIGNATURE,
      channel: ativo,
    });
    expect(inboundQueue.add).not.toHaveBeenCalled();
  });

  it('não regride o caminho feliz: canal ativo segue enfileirando', async () => {
    const { dropReporter, inboundQueue, controller, req, res } = build();

    await controller.handleWebhook('WHATSAPP_WASENDER' as any, req, res);

    expect(dropReporter.reportDrop).not.toHaveBeenCalled();
    expect(inboundQueue.add).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ status: 'ok' });
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
npx jest src/modules/channel-hub/webhook-gateway.controller.spec.ts
```

Esperado: FAIL — o controller ainda tem 5 parâmetros no construtor e não chama `reportDrop`.

- [ ] **Step 3: Injetar o reporter no controller**

Em `src/modules/channel-hub/webhook-gateway.controller.ts`, adicione aos imports:

```ts
import {
  InboundDropReporter,
  InboundDropReason,
} from './inbound-drop-reporter.service';
```

E adicione o parâmetro **por último** no construtor (a ordem importa: o teste da Step 1 passa `dropReporter` na 6ª posição):

```ts
    @Inject(forwardRef(() => MessageTemplatesService))
    private readonly messageTemplatesService: MessageTemplatesService,
    private readonly dropReporter: InboundDropReporter,
  ) {}
```

- [ ] **Step 4: Substituir o caminho `no_locators`**

Troque o bloco atual (linhas ~65-68):

```ts
    const locators = adapter.extractLocators(req.body, headers);
    if (!locators.length) {
      await this.dropReporter.reportDrop({
        channelType,
        reason: InboundDropReason.NO_LOCATORS,
        payload: req.body,
        headers,
        channel: null,
      });
      return res.status(200).json({ status: 'no_locators' });
    }
```

- [ ] **Step 5: Substituir o laço de resolução de canais**

Troque todo o bloco que monta `matchedChannels` e o `if (matchedChannels.length === 0)` (linhas ~70-96) por:

```ts
    // 2. Resolve one or more concrete Channel rows.
    const matchedChannels: Channel[] = [];
    for (const locator of locators) {
      const resolved = await this.channelsService.resolveByLocator(
        channelType,
        (c) => adapter.matchesChannel(c as Channel, locator),
      );

      if (!resolved) {
        await this.dropReporter.reportDrop({
          channelType,
          reason: InboundDropReason.UNKNOWN_LOCATOR,
          payload: req.body,
          headers,
          channel: null,
        });
        continue;
      }

      if (!resolved.active) {
        // Canal existe mas está desativado: continua NÃO processando — só que
        // agora o dono fica sabendo, em vez da mensagem sumir.
        await this.dropReporter.reportDrop({
          channelType,
          reason: InboundDropReason.CHANNEL_INACTIVE,
          payload: req.body,
          headers,
          channel: resolved.channel,
        });
        continue;
      }

      if (!matchedChannels.some((m) => m.id === resolved.channel.id)) {
        matchedChannels.push(resolved.channel);
      }
    }

    if (matchedChannels.length === 0) {
      // Cada locator já foi relatado individualmente acima — relatar de novo
      // aqui duplicaria toda linha de auditoria.
      return res.status(200).json({ status: 'no_matching_channel' });
    }
```

- [ ] **Step 6: Substituir o caminho da assinatura inválida**

Troque o bloco `if (!isValid) { ... continue; }` (linhas ~106-111) por:

```ts
      if (!isValid) {
        await this.dropReporter.reportDrop({
          channelType,
          reason: InboundDropReason.INVALID_SIGNATURE,
          payload: req.body,
          headers,
          channel,
        });
        continue;
      }
```

- [ ] **Step 7: Remover o `recordUnrouted`, agora sem chamadores**

Confirme que ninguém mais usa:

```bash
grep -rn "recordUnrouted" src
```

Esperado: só a definição em `webhook-events.service.ts`. Remova o método inteiro (`async recordUnrouted(...) { ... }`) desse arquivo.

- [ ] **Step 8: Rodar os testes e o compilador**

```bash
npx jest src/modules/channel-hub/webhook-gateway.controller.spec.ts && npx tsc --noEmit
```

Esperado: 5 testes PASS e `tsc` **limpo** (o erro da Task 4 Step 6 desaparece).

- [ ] **Step 9: Commit**

```bash
git add src/modules/channel-hub/webhook-gateway.controller.ts src/modules/channel-hub/webhook-gateway.controller.spec.ts src/modules/channel-hub/webhook-events.service.ts
git commit -m "feat(channel-hub): gateway relata os 4 caminhos de descarte"
```

---

### Task 6: Wiring do módulo e verificação final

**Files:**
- Modify: `src/modules/channel-hub/channel-hub.module.ts`

- [ ] **Step 1: Registrar o provider do Redis e o reporter**

Em `src/modules/channel-hub/channel-hub.module.ts`, adicione aos imports do arquivo:

```ts
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  InboundDropReporter,
  INBOUND_DROP_REDIS,
} from './inbound-drop-reporter.service';
import { NotificationsModule } from '../notifications/notifications.module';
```

Adicione `NotificationsModule` ao array `imports` do `@Module` (sem `forwardRef`: `NotificationsModule` não importa `ChannelHubModule`, então não há ciclo):

```ts
    forwardRef(() => MessagingModule),
    forwardRef(() => MessageTemplatesModule),
    NotificationsModule,
```

Adicione ao array `providers`:

```ts
    WebhookThrottleGuard,
    InboundDropReporter,
    {
      provide: INBOUND_DROP_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis({
          host: config.get<string>('redis.host', 'localhost'),
          port: config.get<number>('redis.port', 6379),
          password: config.get<string>('redis.password') || undefined,
        }),
    },
```

`ConfigModule` é global (`app.module.ts:52`), então não precisa importar.

- [ ] **Step 2: Rodar o guarda de ciclo de DI**

```bash
npx jest src/common/architecture/di-cycle-guard.spec.ts
```

Esperado: PASS. Esse spec existe porque um ciclo de DI já derrubou a produção antes — se ele falhar, **pare** e reveja o `imports` da Step 1.

- [ ] **Step 3: Rodar a suíte inteira**

```bash
npx jest 2>&1 | tail -8
```

Esperado: 1 suíte falhando (`ai-provider-keys.integration.spec.ts`, 5 testes, precisa de Postgres — pré-existente) e **todo o resto passando**. A contagem total deve subir de 998 para ~1016 testes.

- [ ] **Step 4: Rodar o compilador**

```bash
npx tsc --noEmit
```

Esperado: sem saída (limpo).

- [ ] **Step 5: Commit**

```bash
git add src/modules/channel-hub/channel-hub.module.ts
git commit -m "feat(channel-hub): registra InboundDropReporter e cliente Redis"
```

---

## Verificação manual antes do PR

O ganho principal é operacional, então vale um teste de fumaça com o app rodando:

- [ ] Desative um canal de teste pela UI, mande uma mensagem para ele, e confirme: (a) linha nova em `webhook_events` com `status = UNROUTED` e `error_message` começando com `CHANNEL_INACTIVE`, (b) notificação chegando para o OWNER.
- [ ] Mande uma segunda mensagem em seguida e confirme que aparece uma **segunda** linha em `webhook_events` mas **nenhuma** notificação nova (throttle).
- [ ] Reative o canal e confirme que a mensagem volta a ser processada normalmente.

## Deploy

Não há migration. Segue o `DEPLOY-PROTOCOL.md` do repo: branch própria → PR contra `feat/conversation-tabs` (a branch viva) → `deploy-safe.sh`. Sentinela sugerida para verificar o container: a string `InboundDropReporter`.
