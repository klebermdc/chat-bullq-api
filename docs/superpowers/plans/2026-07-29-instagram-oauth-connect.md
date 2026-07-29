# Instagram — Conectar em 1 clique (Fatia 1) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o formulário de token colado à mão por um botão "Conectar Instagram" que faz OAuth, e manter o token de 60 dias vivo sozinho.

**Architecture:** OAuth com callback na **API** (não no web), carregando identidade num `state` assinado com HMAC — assim uma única `redirect_uri` serve todos os domínios white-label. Um cron BullMQ diário renova tokens a menos de 15 dias do vencimento e alerta a org quando falha. O adapter de Instagram já existe e não é tocado.

**Tech Stack:** NestJS 10, Prisma 6, BullMQ, ioredis, axios, Jest. Web: Next.js 15, React Hook Form, Zod.

**Spec:** `docs/superpowers/specs/2026-07-29-instagram-oauth-connect-design.md`

---

## Onde trabalhar

| Repo | Caminho | Branch |
|---|---|---|
| API | `.wt-instagram-oauth/` (worktree já criado) | `feat/instagram-oauth-connect` |
| Web | `chat-bullq-web/` | criar `feat/instagram-oauth-connect` a partir de `fork/feat/conversation-tabs` |

**Regra do projeto:** nunca commitar direto na branch viva `feat/conversation-tabs`. Branch própria + PR.

## Estrutura de arquivos

**API — todos em `src/modules/channel-hub/adapters/instagram/`:**

| Arquivo | Responsabilidade |
|---|---|
| `instagram-platform-config.service.ts` (novo) | Lê credenciais do app da plataforma do env. Só getters. |
| `instagram-oauth-state.service.ts` (novo) | Assina/verifica o `state` do OAuth. Nonce de uso único no Redis. |
| `instagram-connect.service.ts` (novo) | Chamadas Graph + upsert do canal. |
| `instagram-connect.errors.ts` (novo) | `InstagramConnectError` com slug estável. |
| `instagram-token-refresh.cron.ts` (novo) | Job BullMQ diário de renovação + alerta. |
| `instagram.constants.ts` (novo) | Nomes de fila/job e escopos do OAuth. |

**API — modificados:**
- `src/modules/channel-hub/channel-hub.module.ts` — registra os 4 serviços novos como providers **diretos** (é assim que o `WhatsAppEmbeddedSignupService` evita ciclo de DI) e importa `NotificationsModule` + a fila nova.
- `src/modules/channel-hub/channels/channels.controller.ts` — dois endpoints.
- `src/modules/channel-hub/channels/dto/instagram-connect.dto.ts` (novo).
- `.env.example`.

**Web:**
- `src/features/channels/services/channels.service.ts` — um método.
- `src/features/channels/components/create-channel-dialog.tsx` — botão.
- `src/features/channels/components/channel-card.tsx` — selo de token vencendo.
- `src/app/(dashboard)/settings/channels/page.tsx` — toast na volta do OAuth.

---

## Task 1: InstagramPlatformConfigService

Gêmeo do `WhatsAppPlatformConfigService`. Só lê o env.

**Files:**
- Create: `src/modules/channel-hub/adapters/instagram/instagram-platform-config.service.ts`
- Create: `src/modules/channel-hub/adapters/instagram/instagram.constants.ts`
- Test: `src/modules/channel-hub/adapters/instagram/instagram-platform-config.service.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `instagram-platform-config.service.spec.ts`:

```ts
import { InstagramPlatformConfigService } from './instagram-platform-config.service';

describe('InstagramPlatformConfigService', () => {
  const svc = new InstagramPlatformConfigService();
  const ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ENV };
    delete process.env.IG_APP_ID;
    delete process.env.IG_APP_SECRET;
    delete process.env.IG_REDIRECT_URI;
    delete process.env.IG_STATE_SECRET;
    delete process.env.IG_API_VERSION;
    delete process.env.IG_RETURN_ALLOWLIST;
  });

  afterAll(() => {
    process.env = ENV;
  });

  it('apiVersion cai no default v24.0', () => {
    expect(svc.apiVersion).toBe('v24.0');
  });

  it('apiVersion respeita o env', () => {
    process.env.IG_API_VERSION = 'v25.0';
    expect(svc.apiVersion).toBe('v25.0');
  });

  it('returnAllowlist parseia lista separada por virgula e ignora espacos', () => {
    process.env.IG_RETURN_ALLOWLIST = ' sendtur.com.br , app.exemplo.com ';
    expect(svc.returnAllowlist).toEqual(['sendtur.com.br', 'app.exemplo.com']);
  });

  it('returnAllowlist vazia quando o env nao existe', () => {
    expect(svc.returnAllowlist).toEqual([]);
  });

  it('isConfigured e falso sem as credenciais', () => {
    expect(svc.isConfigured).toBe(false);
  });

  it('isConfigured exige appId, appSecret, redirectUri e stateSecret', () => {
    process.env.IG_APP_ID = 'app';
    process.env.IG_APP_SECRET = 'sec';
    process.env.IG_REDIRECT_URI = 'https://api.exemplo.com/cb';
    expect(svc.isConfigured).toBe(false);
    process.env.IG_STATE_SECRET = 'st';
    expect(svc.isConfigured).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
npx jest src/modules/channel-hub/adapters/instagram/instagram-platform-config.service.spec.ts
```

Esperado: FAIL — `Cannot find module './instagram-platform-config.service'`.

- [ ] **Step 3: Criar as constantes**

Criar `instagram.constants.ts`:

```ts
/** Fila BullMQ que renova os tokens de 60 dias do Instagram. */
export const IG_TOKEN_REFRESH_QUEUE = 'instagram-token-refresh';
export const IG_TOKEN_REFRESH_JOB = 'refresh-instagram-tokens';

/**
 * Escopos pedidos no OAuth. `manage_comments` não é usado nesta fatia, mas entra
 * na mesma submissão de App Review pra não precisar de uma segunda rodada quando
 * a Fatia 2 (comentário→DM) chegar.
 */
export const IG_OAUTH_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
].join(',');

/** Campos de webhook assinados no /subscribed_apps. */
export const IG_SUBSCRIBED_FIELDS = 'messages,messaging_postbacks,messaging_seen';
```

- [ ] **Step 4: Implementar o serviço**

Criar `instagram-platform-config.service.ts`:

```ts
import { Injectable } from '@nestjs/common';

/**
 * Credenciais do app da plataforma (o app Meta da OFP) para o Instagram.
 * O Instagram tem App ID/Secret PRÓPRIOS dentro do mesmo app Meta que hospeda
 * o WhatsApp — não são os `WA_*`. Ficam na página do produto Instagram, não em
 * Configurações → Básico.
 */
@Injectable()
export class InstagramPlatformConfigService {
  get appId(): string {
    return process.env.IG_APP_ID ?? '';
  }

  get appSecret(): string {
    return process.env.IG_APP_SECRET ?? '';
  }

  get redirectUri(): string {
    return process.env.IG_REDIRECT_URI ?? '';
  }

  get apiVersion(): string {
    return process.env.IG_API_VERSION || 'v24.0';
  }

  get stateSecret(): string {
    return process.env.IG_STATE_SECRET ?? '';
  }

  /** Hosts para os quais o callback pode redirecionar de volta. */
  get returnAllowlist(): string[] {
    return (process.env.IG_RETURN_ALLOWLIST ?? '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
  }

  /** Quantos dias antes do vencimento o cron tenta renovar. */
  get refreshThresholdDays(): number {
    const raw = Number(process.env.IG_TOKEN_REFRESH_THRESHOLD_DAYS);
    return Number.isFinite(raw) && raw > 0 ? raw : 15;
  }

  get isConfigured(): boolean {
    return Boolean(
      this.appId && this.appSecret && this.redirectUri && this.stateSecret,
    );
  }
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

```bash
npx jest src/modules/channel-hub/adapters/instagram/instagram-platform-config.service.spec.ts
```

Esperado: PASS, 6 testes.

- [ ] **Step 6: Commit**

```bash
git add src/modules/channel-hub/adapters/instagram/instagram-platform-config.service.ts \
        src/modules/channel-hub/adapters/instagram/instagram-platform-config.service.spec.ts \
        src/modules/channel-hub/adapters/instagram/instagram.constants.ts
git commit -m "feat(instagram): config da plataforma e constantes do OAuth"
```

---

## Task 2: InstagramOAuthStateService

O `state` carrega a identidade através do redirect da Meta, porque o JWT não sobrevive a ele. Por isso ele **precisa** ser assinado, expirar, e valer uma vez só.

**Files:**
- Create: `src/modules/channel-hub/adapters/instagram/instagram-oauth-state.service.ts`
- Test: `src/modules/channel-hub/adapters/instagram/instagram-oauth-state.service.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `instagram-oauth-state.service.spec.ts`:

```ts
import { OrgRole } from '@prisma/client';
import { InstagramOAuthStateService } from './instagram-oauth-state.service';
import { InstagramPlatformConfigService } from './instagram-platform-config.service';

describe('InstagramOAuthStateService', () => {
  const platform = new InstagramPlatformConfigService();
  let redis: { set: jest.Mock };
  let svc: InstagramOAuthStateService;

  const payload = {
    organizationId: 'org_1',
    userOrganizationId: 'uo_1',
    role: OrgRole.OWNER,
    returnTo: 'https://sendtur.com.br/settings/channels',
  };

  beforeEach(() => {
    process.env.IG_STATE_SECRET = 'segredo-de-teste';
    process.env.IG_RETURN_ALLOWLIST = 'sendtur.com.br';
    // SETNX bem-sucedido devolve 'OK'; nonce já usado devolve null.
    redis = { set: jest.fn().mockResolvedValue('OK') };
    svc = new InstagramOAuthStateService(platform, redis as any);
  });

  it('assina e verifica ida e volta', async () => {
    const state = svc.sign(payload);
    await expect(svc.verify(state)).resolves.toMatchObject({
      organizationId: 'org_1',
      userOrganizationId: 'uo_1',
      role: OrgRole.OWNER,
      returnTo: 'https://sendtur.com.br/settings/channels',
    });
  });

  it('rejeita assinatura adulterada', async () => {
    const state = svc.sign(payload);
    const [body] = state.split('.');
    await expect(svc.verify(`${body}.deadbeef`)).rejects.toThrow(/state/i);
  });

  it('rejeita payload adulterado', async () => {
    const state = svc.sign(payload);
    const [, sig] = state.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...payload, organizationId: 'org_INVASOR', nonce: 'n', exp: Date.now() + 1000 }),
    ).toString('base64url');
    await expect(svc.verify(`${forged}.${sig}`)).rejects.toThrow(/state/i);
  });

  it('rejeita state expirado', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const state = svc.sign(payload);
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000 + 11 * 60 * 1000);
    await expect(svc.verify(state)).rejects.toThrow(/expirad/i);
    jest.spyOn(Date, 'now').mockRestore();
  });

  it('rejeita nonce reusado', async () => {
    const state = svc.sign(payload);
    redis.set.mockResolvedValueOnce(null); // SETNX falhou = já existe
    await expect(svc.verify(state)).rejects.toThrow(/uma vez|reus/i);
  });

  it('rejeita returnTo fora da allowlist', async () => {
    const state = svc.sign({ ...payload, returnTo: 'https://evil.example.com/x' });
    await expect(svc.verify(state)).rejects.toThrow(/returnTo|destino/i);
  });

  it('rejeita returnTo sem https', async () => {
    const state = svc.sign({ ...payload, returnTo: 'http://sendtur.com.br/x' });
    await expect(svc.verify(state)).rejects.toThrow(/https|destino/i);
  });

  it('queima o nonce com TTL e flag NX', async () => {
    const state = svc.sign(payload);
    await svc.verify(state);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^ig:oauth:nonce:/),
      '1',
      'EX',
      600,
      'NX',
    );
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
npx jest src/modules/channel-hub/adapters/instagram/instagram-oauth-state.service.spec.ts
```

Esperado: FAIL — `Cannot find module './instagram-oauth-state.service'`.

- [ ] **Step 3: Implementar o serviço**

Criar `instagram-oauth-state.service.ts`:

```ts
import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import { InstagramPlatformConfigService } from './instagram-platform-config.service';

export const IG_OAUTH_REDIS = 'IG_OAUTH_REDIS';

/** Quanto tempo o state vale. A Meta leva segundos; 10 min é folga de sobra. */
const STATE_TTL_SECONDS = 600;

export interface IgOAuthStateInput {
  organizationId: string;
  userOrganizationId: string;
  role: OrgRole;
  /** URL absoluta https para onde o callback redireciona de volta. */
  returnTo: string;
}

export interface IgOAuthStatePayload extends IgOAuthStateInput {
  nonce: string;
  /** epoch ms */
  exp: number;
}

/**
 * O `state` do OAuth carrega a identidade através do redirect da Meta, porque o
 * JWT não sobrevive a ele. Como o `/callback` roda SEM guard, tudo que vem aqui
 * dentro precisa ser inforjável: HMAC com segredo nosso, validade curta, e nonce
 * de uso único pra um state interceptado não servir duas vezes.
 */
@Injectable()
export class InstagramOAuthStateService {
  constructor(
    private readonly platform: InstagramPlatformConfigService,
    @Inject(IG_OAUTH_REDIS) private readonly redis: Redis,
  ) {}

  private hmac(body: string): string {
    return crypto
      .createHmac('sha256', this.platform.stateSecret)
      .update(body)
      .digest('hex');
  }

  sign(input: IgOAuthStateInput): string {
    const payload: IgOAuthStatePayload = {
      ...input,
      nonce: crypto.randomBytes(16).toString('hex'),
      exp: Date.now() + STATE_TTL_SECONDS * 1000,
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.hmac(body)}`;
  }

  async verify(state: string): Promise<IgOAuthStatePayload> {
    const [body, signature] = (state ?? '').split('.');
    if (!body || !signature) {
      throw new BadRequestException('state malformado');
    }

    const expected = this.hmac(body);
    const ok =
      signature.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!ok) {
      throw new BadRequestException('state com assinatura invalida');
    }

    let payload: IgOAuthStatePayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      throw new BadRequestException('state ilegivel');
    }

    if (!payload.exp || payload.exp < Date.now()) {
      throw new BadRequestException('state expirado');
    }

    this.assertReturnToPermitido(payload.returnTo);

    // Uso único: SETNX devolve null se a chave já existe.
    const burned = await this.redis.set(
      `ig:oauth:nonce:${payload.nonce}`,
      '1',
      'EX',
      STATE_TTL_SECONDS,
      'NX',
    );
    if (burned !== 'OK') {
      throw new BadRequestException('state ja usado — vale uma vez so');
    }

    return payload;
  }

  /**
   * O `returnTo` só chega aqui dentro de um state que nós assinamos, então não é
   * input de terceiro. A allowlist protege do nosso próprio erro: um returnTo mal
   * preenchido no /authorize mandaria o usuário para fora do produto depois de
   * autorizar. Host na allowlist e https obrigatório.
   */
  private assertReturnToPermitido(returnTo: string): void {
    let url: URL;
    try {
      url = new URL(returnTo);
    } catch {
      throw new BadRequestException('destino de retorno invalido');
    }
    if (url.protocol !== 'https:') {
      throw new BadRequestException('destino de retorno precisa ser https');
    }
    if (!this.platform.returnAllowlist.includes(url.host)) {
      throw new BadRequestException(`returnTo nao permitido: ${url.host}`);
    }
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
npx jest src/modules/channel-hub/adapters/instagram/instagram-oauth-state.service.spec.ts
```

Esperado: PASS, 8 testes.

- [ ] **Step 5: Commit**

```bash
git add src/modules/channel-hub/adapters/instagram/instagram-oauth-state.service.ts \
        src/modules/channel-hub/adapters/instagram/instagram-oauth-state.service.spec.ts
git commit -m "feat(instagram): state assinado de uso unico para o OAuth"
```

---

## Task 3: Chamadas Graph do InstagramConnectService

Só as chamadas HTTP. O `connect()` que as orquestra vem na Task 4.

**Files:**
- Create: `src/modules/channel-hub/adapters/instagram/instagram-connect.errors.ts`
- Create: `src/modules/channel-hub/adapters/instagram/instagram-connect.service.ts`
- Test: `src/modules/channel-hub/adapters/instagram/instagram-connect.service.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `instagram-connect.service.spec.ts`:

```ts
import axios from 'axios';
import { InstagramConnectService } from './instagram-connect.service';
import { InstagramPlatformConfigService } from './instagram-platform-config.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('InstagramConnectService (chamadas Graph)', () => {
  const platform = new InstagramPlatformConfigService();
  const svc = new InstagramConnectService(
    platform,
    {} as any, // ChannelsService
    {} as any, // ChannelsRepository
  );

  beforeEach(() => {
    process.env.IG_APP_ID = 'app';
    process.env.IG_APP_SECRET = 'sec';
    process.env.IG_REDIRECT_URI = 'https://api.exemplo.com/cb';
    process.env.IG_API_VERSION = 'v24.0';
    jest.clearAllMocks();
  });

  it('exchangeCodeForToken faz POST form-urlencoded em api.instagram.com', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { access_token: 'CURTO', user_id: 256111 },
    } as any);

    await expect(svc.exchangeCodeForToken('code123')).resolves.toEqual({
      accessToken: 'CURTO',
      loginUserId: '256111',
    });

    const [url, body, cfg] = mockedAxios.post.mock.calls[0];
    expect(url).toBe('https://api.instagram.com/oauth/access_token');
    expect(String(body)).toContain('grant_type=authorization_code');
    expect(String(body)).toContain('code=code123');
    expect((cfg as any).headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('exchangeCodeForToken lanca code_expirado quando a Meta recusa o code', async () => {
    mockedAxios.post.mockRejectedValueOnce({
      response: { data: { error_message: 'This authorization code has been used' } },
    });
    await expect(svc.exchangeCodeForToken('velho')).rejects.toMatchObject({
      slug: 'code_expirado',
    });
  });

  it('exchangeForLongLived troca por token de 60 dias', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { access_token: 'LONGO', expires_in: 5184000 },
    } as any);

    await expect(svc.exchangeForLongLived('CURTO')).resolves.toEqual({
      accessToken: 'LONGO',
      expiresIn: 5184000,
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://graph.instagram.com/access_token',
      { params: { grant_type: 'ig_exchange_token', client_secret: 'sec', access_token: 'CURTO' } },
    );
  });

  it('fetchMe devolve o user_id que casa com o entry.id do webhook', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { id: '256111', user_id: '17841400000000000', username: 'lojax' },
    } as any);

    await expect(svc.fetchMe('LONGO')).resolves.toEqual({
      igBusinessId: '17841400000000000',
      username: 'lojax',
    });
  });

  it('fetchMe lanca sem_conta_business quando nao vem user_id', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { id: '256111', username: 'pessoal' } } as any);
    await expect(svc.fetchMe('LONGO')).rejects.toMatchObject({ slug: 'sem_conta_business' });
  });

  it('subscribeApp assina os campos de webhook com Bearer', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } } as any);
    await svc.subscribeApp('17841400000000000', 'LONGO');
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://graph.instagram.com/v24.0/17841400000000000/subscribed_apps',
      { subscribed_fields: 'messages,messaging_postbacks,messaging_seen' },
      { headers: { Authorization: 'Bearer LONGO' } },
    );
  });

  it('subscribeApp lanca falha_inscricao quando a Meta recusa', async () => {
    mockedAxios.post.mockRejectedValueOnce({ response: { data: { error: { message: 'nope' } } } });
    await expect(svc.subscribeApp('IG1', 'LONGO')).rejects.toMatchObject({
      slug: 'falha_inscricao',
    });
  });

  it('nao loga o code nem o token inteiros', async () => {
    const logSpy = jest
      .spyOn((svc as any).logger, 'error')
      .mockImplementation(() => undefined);
    mockedAxios.post.mockRejectedValueOnce({
      response: { data: { error_message: 'This authorization code has been used' } },
    });

    await expect(
      svc.exchangeCodeForToken('CODE_SUPER_SECRETO_INTEIRO_1234567890'),
    ).rejects.toMatchObject({ slug: 'code_expirado' });

    const logado = logSpy.mock.calls.flat().join(' ');
    expect(logado).not.toContain('CODE_SUPER_SECRETO_INTEIRO_1234567890');
    expect(logado).toContain('CODE_SUPER_SE'); // prefixo de 12 chars + reticencia
    logSpy.mockRestore();
  });

  it('refreshToken renova o token longo', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { access_token: 'NOVO', expires_in: 5184000 },
    } as any);
    await expect(svc.refreshToken('LONGO')).resolves.toEqual({
      accessToken: 'NOVO',
      expiresIn: 5184000,
    });
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://graph.instagram.com/refresh_access_token',
      { params: { grant_type: 'ig_refresh_token', access_token: 'LONGO' } },
    );
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
npx jest src/modules/channel-hub/adapters/instagram/instagram-connect.service.spec.ts
```

Esperado: FAIL — `Cannot find module './instagram-connect.service'`.

- [ ] **Step 3: Criar a classe de erro**

Criar `instagram-connect.errors.ts`:

```ts
/**
 * Slugs estáveis que viajam na URL de volta pro web. A mensagem crua da Meta
 * fica só no log — ela muda sem aviso e às vezes carrega dado sensível.
 */
export type InstagramConnectSlug =
  | 'state_invalido'
  | 'code_expirado'
  | 'permissao_negada'
  | 'sem_conta_business'
  | 'falha_inscricao'
  | 'erro_interno';

export class InstagramConnectError extends Error {
  constructor(
    readonly slug: InstagramConnectSlug,
    message: string,
  ) {
    super(message);
    this.name = 'InstagramConnectError';
  }
}
```

- [ ] **Step 4: Implementar as chamadas Graph**

Criar `instagram-connect.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { InstagramPlatformConfigService } from './instagram-platform-config.service';
import { ChannelsService } from '../../channels/channels.service';
import { ChannelsRepository } from '../../channels/channels.repository';
import { InstagramConnectError } from './instagram-connect.errors';
import { IG_SUBSCRIBED_FIELDS } from './instagram.constants';

/** Nunca logamos segredo inteiro — 12 chars bastam pra distinguir os casos. */
export function redact(secret: string | undefined): string {
  return secret ? `${secret.slice(0, 12)}…` : '-';
}

function metaErrorMessage(err: any): string {
  return (
    err?.response?.data?.error?.message ||
    err?.response?.data?.error_message ||
    err?.message ||
    'erro desconhecido'
  );
}

@Injectable()
export class InstagramConnectService {
  private readonly logger = new Logger(InstagramConnectService.name);

  constructor(
    private readonly platform: InstagramPlatformConfigService,
    private readonly channelsService: ChannelsService,
    private readonly channelsRepo: ChannelsRepository,
  ) {}

  private graph(): string {
    return `https://graph.instagram.com/${this.platform.apiVersion}`;
  }

  /** Passo 1: code → token curto (vale 1 hora). */
  async exchangeCodeForToken(
    code: string,
  ): Promise<{ accessToken: string; loginUserId: string }> {
    const body = new URLSearchParams({
      client_id: this.platform.appId,
      client_secret: this.platform.appSecret,
      grant_type: 'authorization_code',
      redirect_uri: this.platform.redirectUri,
      code,
    });

    try {
      const { data } = await axios.post(
        'https://api.instagram.com/oauth/access_token',
        body.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      if (!data?.access_token) {
        throw new InstagramConnectError('code_expirado', 'Meta nao devolveu access_token');
      }
      return {
        accessToken: data.access_token,
        loginUserId: String(data.user_id),
      };
    } catch (err: any) {
      if (err instanceof InstagramConnectError) throw err;
      this.logger.error(
        `troca de code falhou: ${metaErrorMessage(err)} (code=${redact(code)})`,
      );
      throw new InstagramConnectError('code_expirado', metaErrorMessage(err));
    }
  }

  /** Passo 2: token curto → token de 60 dias. */
  async exchangeForLongLived(
    shortToken: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    try {
      const { data } = await axios.get('https://graph.instagram.com/access_token', {
        params: {
          grant_type: 'ig_exchange_token',
          client_secret: this.platform.appSecret,
          access_token: shortToken,
        },
      });
      if (!data?.access_token) {
        throw new InstagramConnectError('erro_interno', 'Meta nao devolveu token longo');
      }
      return { accessToken: data.access_token, expiresIn: data.expires_in ?? 5184000 };
    } catch (err: any) {
      if (err instanceof InstagramConnectError) throw err;
      this.logger.error(`troca por token longo falhou: ${metaErrorMessage(err)}`);
      throw new InstagramConnectError('erro_interno', metaErrorMessage(err));
    }
  }

  /**
   * Passo 3: descobre a identidade. O `user_id` DAQUI é o que casa com o
   * `entry.id` do webhook — NÃO é o `user_id` que veio junto com o token curto.
   * Confundir os dois é a origem do "self-healing" que outros projetos precisam
   * fazer no webhook pra adivinhar o dono da mensagem.
   */
  async fetchMe(token: string): Promise<{ igBusinessId: string; username: string }> {
    let data: any;
    try {
      const res = await axios.get(`${this.graph()}/me`, {
        params: { fields: 'user_id,username', access_token: token },
      });
      data = res.data;
    } catch (err: any) {
      this.logger.error(`/me falhou: ${metaErrorMessage(err)}`);
      throw new InstagramConnectError('sem_conta_business', metaErrorMessage(err));
    }

    if (!data?.user_id) {
      throw new InstagramConnectError(
        'sem_conta_business',
        'A conta nao e profissional (o /me nao devolveu user_id).',
      );
    }
    return { igBusinessId: String(data.user_id), username: data.username ?? 'instagram' };
  }

  /** Passo 4: sem isso o canal nasce mudo — recebe zero webhook. */
  async subscribeApp(igBusinessId: string, token: string): Promise<void> {
    try {
      await axios.post(
        `${this.graph()}/${igBusinessId}/subscribed_apps`,
        { subscribed_fields: IG_SUBSCRIBED_FIELDS },
        { headers: { Authorization: `Bearer ${token}` } },
      );
    } catch (err: any) {
      this.logger.error(`subscribed_apps falhou: ${metaErrorMessage(err)}`);
      throw new InstagramConnectError('falha_inscricao', metaErrorMessage(err));
    }
  }

  /** Renova o token de 60 dias. Exige token com >=24h de idade e ainda valido. */
  async refreshToken(
    token: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const { data } = await axios.get('https://graph.instagram.com/refresh_access_token', {
      params: { grant_type: 'ig_refresh_token', access_token: token },
    });
    if (!data?.access_token) {
      throw new Error('refresh_access_token nao devolveu token');
    }
    return { accessToken: data.access_token, expiresIn: data.expires_in ?? 5184000 };
  }
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

```bash
npx jest src/modules/channel-hub/adapters/instagram/instagram-connect.service.spec.ts
```

Esperado: PASS, 9 testes.

- [ ] **Step 6: Commit**

```bash
git add src/modules/channel-hub/adapters/instagram/instagram-connect.service.ts \
        src/modules/channel-hub/adapters/instagram/instagram-connect.service.spec.ts \
        src/modules/channel-hub/adapters/instagram/instagram-connect.errors.ts
git commit -m "feat(instagram): chamadas Graph do fluxo de conexao"
```

---

## Task 4: connect() — upsert do canal

**Files:**
- Modify: `src/modules/channel-hub/adapters/instagram/instagram-connect.service.ts`
- Modify: `src/modules/channel-hub/adapters/instagram/instagram-connect.service.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao fim de `instagram-connect.service.spec.ts` (fora do `describe` existente):

```ts
import { ChannelType, OrgRole } from '@prisma/client';

describe('InstagramConnectService.connect', () => {
  const platform = new InstagramPlatformConfigService();
  let channelsService: { create: jest.Mock };
  let channelsRepo: { findActiveByTypeAndOrg: jest.Mock; update: jest.Mock };
  let svc: InstagramConnectService;

  const identidade = {
    organizationId: 'org_1',
    userOrganizationId: 'uo_1',
    role: OrgRole.OWNER,
  };

  function mockFluxoFeliz() {
    // 1) code -> token curto
    mockedAxios.post.mockResolvedValueOnce({
      data: { access_token: 'CURTO', user_id: 256111 },
    } as any);
    // 2) token curto -> token longo
    mockedAxios.get.mockResolvedValueOnce({
      data: { access_token: 'LONGO', expires_in: 5184000 },
    } as any);
    // 3) /me
    mockedAxios.get.mockResolvedValueOnce({
      data: { id: '256111', user_id: '17841400000000000', username: 'lojax' },
    } as any);
    // 4) subscribed_apps
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } } as any);
  }

  beforeEach(() => {
    process.env.IG_APP_ID = 'app';
    process.env.IG_APP_SECRET = 'sec';
    process.env.IG_REDIRECT_URI = 'https://api.exemplo.com/cb';
    process.env.IG_API_VERSION = 'v24.0';
    jest.clearAllMocks();

    channelsService = { create: jest.fn(async (_o, dto) => ({ id: 'ch_novo', ...dto })) };
    channelsRepo = {
      findActiveByTypeAndOrg: jest.fn().mockResolvedValue([]),
      update: jest.fn(async (id, data) => ({ id, ...data })),
    };
    svc = new InstagramConnectService(platform, channelsService as any, channelsRepo as any);
  });

  it('grava o user_id do /me como igBusinessId, nao o do token', async () => {
    mockFluxoFeliz();
    await svc.connect({ code: 'c1', ...identidade });

    const [, dto] = channelsService.create.mock.calls[0];
    expect(dto.config.igBusinessId).toBe('17841400000000000');
    expect(dto.config.igUserId).toBe('256111');
    expect(dto.type).toBe(ChannelType.INSTAGRAM);
    expect(dto.name).toBe('lojax');
  });

  it('carimba o appSecret da plataforma para o validateWebhook nao ficar fail-open', async () => {
    mockFluxoFeliz();
    await svc.connect({ code: 'c1', ...identidade });
    const [, dto] = channelsService.create.mock.calls[0];
    expect(dto.config.appSecret).toBe('sec');
  });

  it('grava tokenExpiresAt a partir do expires_in', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000_000_000);
    mockFluxoFeliz();
    await svc.connect({ code: 'c1', ...identidade });
    const [, dto] = channelsService.create.mock.calls[0];
    expect(dto.config.tokenExpiresAt).toBe(
      new Date(1_000_000_000_000 + 5184000 * 1000).toISOString(),
    );
    jest.spyOn(Date, 'now').mockRestore();
  });

  it('reconectar atualiza o canal existente em vez de criar outro', async () => {
    channelsRepo.findActiveByTypeAndOrg.mockResolvedValue([
      { id: 'ch_velho', config: { igBusinessId: '17841400000000000', apelido: 'preservar' } },
    ]);
    mockFluxoFeliz();

    await svc.connect({ code: 'c1', ...identidade });

    expect(channelsService.create).not.toHaveBeenCalled();
    expect(channelsRepo.update).toHaveBeenCalledWith(
      'ch_velho',
      expect.objectContaining({
        config: expect.objectContaining({
          igBusinessId: '17841400000000000',
          accessToken: 'LONGO',
          apelido: 'preservar', // não joga fora o que já estava no config
        }),
      }),
    );
  });

  it('falha no subscribed_apps aborta e nao deixa canal orfao', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { access_token: 'CURTO', user_id: 256111 },
    } as any);
    mockedAxios.get.mockResolvedValueOnce({
      data: { access_token: 'LONGO', expires_in: 5184000 },
    } as any);
    mockedAxios.get.mockResolvedValueOnce({
      data: { id: '256111', user_id: '17841400000000000', username: 'lojax' },
    } as any);
    mockedAxios.post.mockRejectedValueOnce({ response: { data: { error: { message: 'nope' } } } });

    await expect(svc.connect({ code: 'c1', ...identidade })).rejects.toMatchObject({
      slug: 'falha_inscricao',
    });
    expect(channelsService.create).not.toHaveBeenCalled();
    expect(channelsRepo.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
npx jest src/modules/channel-hub/adapters/instagram/instagram-connect.service.spec.ts -t "connect"
```

Esperado: FAIL — `svc.connect is not a function`.

- [ ] **Step 3: Implementar o connect()**

Adicionar ao fim da classe `InstagramConnectService` (antes do fecha-chaves), e acrescentar `ChannelType`/`OrgRole`/`Channel` aos imports do `@prisma/client`:

```ts
  /**
   * Orquestra o fluxo inteiro. A inscrição no webhook acontece ANTES de tocar no
   * banco: se ela falhar, a gente não deixa pra trás um canal que existe na tela
   * mas nunca recebe mensagem — que é pior que não ter canal nenhum.
   */
  async connect(params: {
    code: string;
    organizationId: string;
    userOrganizationId: string;
    role: OrgRole;
  }): Promise<Channel> {
    const short = await this.exchangeCodeForToken(params.code);
    const long = await this.exchangeForLongLived(short.accessToken);
    const me = await this.fetchMe(long.accessToken);

    await this.subscribeApp(me.igBusinessId, long.accessToken);

    const config: Record<string, any> = {
      igBusinessId: me.igBusinessId,
      igUserId: short.loginUserId,
      username: me.username,
      accessToken: long.accessToken,
      tokenExpiresAt: new Date(Date.now() + long.expiresIn * 1000).toISOString(),
      appSecret: this.platform.appSecret,
      apiVersion: this.platform.apiVersion,
      connectedAt: new Date().toISOString(),
      refreshFailures: 0,
    };

    const existentes = await this.channelsRepo.findActiveByTypeAndOrg(
      ChannelType.INSTAGRAM,
      params.organizationId,
    );
    const existente = existentes.find(
      (c) => (c.config as Record<string, any>)?.igBusinessId === me.igBusinessId,
    );

    if (existente) {
      this.logger.log(
        `Instagram: reconectando canal ${existente.id} (@${me.username} / ${me.igBusinessId})`,
      );
      return this.channelsRepo.update(existente.id, {
        name: me.username,
        config: { ...(existente.config as Record<string, any>), ...config },
      });
    }

    this.logger.log(
      `Instagram: criando canal para @${me.username} (${me.igBusinessId})`,
    );
    return this.channelsService.create(
      params.organizationId,
      { type: ChannelType.INSTAGRAM, name: me.username, config },
      { userOrganizationId: params.userOrganizationId, role: params.role },
    );
  }
```

- [ ] **Step 4: Rodar o arquivo de teste inteiro**

```bash
npx jest src/modules/channel-hub/adapters/instagram/instagram-connect.service.spec.ts
```

Esperado: PASS, 14 testes (9 da Task 3 + 5 desta).

- [ ] **Step 5: Commit**

```bash
git add src/modules/channel-hub/adapters/instagram/instagram-connect.service.ts \
        src/modules/channel-hub/adapters/instagram/instagram-connect.service.spec.ts
git commit -m "feat(instagram): connect() com upsert de canal por igBusinessId"
```

---

## Task 5: Endpoints /authorize e /callback

**Files:**
- Create: `src/modules/channel-hub/channels/dto/instagram-connect.dto.ts`
- Modify: `src/modules/channel-hub/channels/channels.controller.ts`
- Modify: `src/modules/channel-hub/channel-hub.module.ts`

- [ ] **Step 1: Criar o DTO**

Criar `src/modules/channel-hub/channels/dto/instagram-connect.dto.ts`:

```ts
import { IsString, IsOptional, IsUrl } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class InstagramAuthorizeQueryDto {
  @ApiPropertyOptional({
    description:
      'URL absoluta https para onde voltar depois do OAuth. Precisa estar na IG_RETURN_ALLOWLIST.',
    example: 'https://sendtur.com.br/settings/channels',
  })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  returnTo?: string;
}

export class InstagramCallbackQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;

  /** A Meta manda `error=access_denied` quando o usuário cancela. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  error?: string;
}
```

- [ ] **Step 2: Adicionar os endpoints ao controller**

Em `src/modules/channel-hub/channels/channels.controller.ts`, acrescentar aos imports:

```ts
import { Get, Query, Res, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { InstagramConnectService } from '../adapters/instagram/instagram-connect.service';
import { InstagramOAuthStateService } from '../adapters/instagram/instagram-oauth-state.service';
import { InstagramPlatformConfigService } from '../adapters/instagram/instagram-platform-config.service';
import { InstagramConnectError } from '../adapters/instagram/instagram-connect.errors';
import { IG_OAUTH_SCOPES } from '../adapters/instagram/instagram.constants';
import {
  InstagramAuthorizeQueryDto,
  InstagramCallbackQueryDto,
} from './dto/instagram-connect.dto';
```

Adicionar ao construtor:

```ts
    private readonly igConnect: InstagramConnectService,
    private readonly igState: InstagramOAuthStateService,
    private readonly igPlatform: InstagramPlatformConfigService,
```

Adicionar os dois métodos à classe:

```ts
  @Get('instagram/authorize')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Devolve a URL de autorizacao do Instagram com o state assinado.' })
  instagramAuthorize(
    @CurrentOrg() org: { id: string; userOrganizationId: string; userRole: OrgRole },
    @Query() query: InstagramAuthorizeQueryDto,
  ): { url: string } {
    if (!this.igPlatform.isConfigured) {
      throw new BadRequestException(
        'Instagram nao configurado no servidor (faltam IG_APP_ID / IG_APP_SECRET / IG_REDIRECT_URI / IG_STATE_SECRET).',
      );
    }

    const returnTo = query.returnTo;
    if (!returnTo) {
      throw new BadRequestException('returnTo e obrigatorio');
    }

    const state = this.igState.sign({
      organizationId: org.id,
      userOrganizationId: org.userOrganizationId,
      role: org.userRole,
      returnTo,
    });

    const params = new URLSearchParams({
      enable_fb_login: '0',
      force_authentication: '1',
      client_id: this.igPlatform.appId,
      redirect_uri: this.igPlatform.redirectUri,
      response_type: 'code',
      scope: IG_OAUTH_SCOPES,
      state,
    });

    return { url: `https://www.instagram.com/oauth/authorize?${params.toString()}` };
  }
```

- [ ] **Step 3: Adicionar o callback**

O `/callback` roda **sem guard** — quem chama é a Meta, que não tem JWT nosso. A identidade vem do `state` assinado. Como `@UseGuards` está na classe, é preciso marcar a rota como pública. Verificar o decorator do projeto:

```bash
grep -rn "IS_PUBLIC_KEY\|@Public()" src/common/decorators src/common/guards | head
```

Se existir `@Public()`, usar. Se **não** existir, mover o `/callback` para um controller próprio sem `@UseGuards`, criando `src/modules/channel-hub/channels/instagram-callback.controller.ts` com o mesmo corpo e registrando-o em `controllers:` do `ChannelHubModule`.

Corpo do método (vale para os dois caminhos):

```ts
  @Get('instagram/callback')
  @ApiOperation({ summary: 'Callback do OAuth do Instagram. Chamado pela Meta, sem JWT.' })
  async instagramCallback(
    @Query() query: InstagramCallbackQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    // A Meta manda `error` quando o usuário cancela na tela dela. Sem state
    // válido não dá pra saber pra onde voltar, então caímos no fallback.
    const fallback = this.igPlatform.returnAllowlist[0]
      ? `https://${this.igPlatform.returnAllowlist[0]}/settings/channels`
      : '/';

    let payload;
    try {
      payload = await this.igState.verify(query.state ?? '');
    } catch {
      res.redirect(`${fallback}?ig=erro&motivo=state_invalido`);
      return;
    }

    if (query.error || !query.code) {
      res.redirect(`${payload.returnTo}?ig=erro&motivo=permissao_negada`);
      return;
    }

    try {
      const channel = await this.igConnect.connect({
        code: query.code,
        organizationId: payload.organizationId,
        userOrganizationId: payload.userOrganizationId,
        role: payload.role,
      });
      res.redirect(`${payload.returnTo}?ig=ok&channel=${channel.id}`);
    } catch (err: any) {
      const motivo = err instanceof InstagramConnectError ? err.slug : 'erro_interno';
      res.redirect(`${payload.returnTo}?ig=erro&motivo=${motivo}`);
    }
  }
```

- [ ] **Step 4: Registrar os providers no ChannelHubModule**

Em `src/modules/channel-hub/channel-hub.module.ts`.

**Importante:** os três serviços entram como providers **diretos do ChannelHubModule**, não do `InstagramModule`. É assim que o `WhatsAppEmbeddedSignupService` já faz — eles precisam de `ChannelsService`/`ChannelsRepository`, que vivem neste módulo, e declarar lá dentro criaria import cruzado e ciclo de DI.

Acrescentar aos imports do arquivo:

```ts
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { InstagramPlatformConfigService } from './adapters/instagram/instagram-platform-config.service';
import {
  InstagramOAuthStateService,
  IG_OAUTH_REDIS,
} from './adapters/instagram/instagram-oauth-state.service';
import { InstagramConnectService } from './adapters/instagram/instagram-connect.service';
```

Acrescentar ao array `providers:`:

```ts
    InstagramPlatformConfigService,
    InstagramOAuthStateService,
    InstagramConnectService,
    {
      // Cliente Redis local, no mesmo padrão do PresenceService e do
      // IdempotencyService. Quando houver um RedisModule global, trocar.
      provide: IG_OAUTH_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis({
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        }),
    },
```

- [ ] **Step 5: Compilar e rodar o portão de ciclo de DI**

```bash
npx tsc --noEmit
npx jest src/common/architecture/di-cycle-guard.spec.ts
```

Esperado: `tsc` sem erro; o guard PASS. Se o guard acusar `UndefinedDependencyException`, o ciclo voltou — reveja se algum serviço novo foi parar dentro do `InstagramModule` em vez do `ChannelHubModule`.

- [ ] **Step 6: Commit**

```bash
git add src/modules/channel-hub/channels/ src/modules/channel-hub/channel-hub.module.ts
git commit -m "feat(instagram): endpoints /authorize e /callback do OAuth"
```

---

## Task 6: Cron de renovação do token

**Files:**
- Create: `src/modules/channel-hub/adapters/instagram/instagram-token-refresh.cron.ts`
- Create: `src/modules/channel-hub/adapters/instagram/instagram-token-refresh.cron.spec.ts`
- Modify: `src/modules/channel-hub/channel-hub.module.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `instagram-token-refresh.cron.spec.ts`:

```ts
import { NotificationType } from '@prisma/client';
import { InstagramTokenRefreshCron } from './instagram-token-refresh.cron';
import { InstagramPlatformConfigService } from './instagram-platform-config.service';

const DIA = 24 * 60 * 60 * 1000;

function canal(diasRestantes: number, extra: Record<string, any> = {}) {
  return {
    id: 'ch_1',
    organizationId: 'org_1',
    name: 'lojax',
    config: {
      igBusinessId: 'IG1',
      accessToken: 'LONGO',
      tokenExpiresAt: new Date(Date.now() + diasRestantes * DIA).toISOString(),
      ...extra,
    },
  };
}

describe('InstagramTokenRefreshCron', () => {
  const platform = new InstagramPlatformConfigService();
  let repo: { findActiveByType: jest.Mock; update: jest.Mock };
  let connect: { refreshToken: jest.Mock };
  let notifications: { notifyOrgAgents: jest.Mock };
  let redis: { set: jest.Mock };
  let queue: { add: jest.Mock };
  let cron: InstagramTokenRefreshCron;

  beforeEach(() => {
    delete process.env.IG_TOKEN_REFRESH_THRESHOLD_DAYS;
    repo = { findActiveByType: jest.fn(), update: jest.fn().mockResolvedValue({}) };
    connect = { refreshToken: jest.fn() };
    notifications = { notifyOrgAgents: jest.fn().mockResolvedValue({}) };
    redis = { set: jest.fn().mockResolvedValue('OK') };
    queue = { add: jest.fn().mockResolvedValue({}) };
    cron = new InstagramTokenRefreshCron(
      queue as any,
      repo as any,
      connect as any,
      notifications as any,
      platform,
      redis as any,
    );
  });

  it('nao toca em canal com 30 dias restantes', async () => {
    repo.findActiveByType.mockResolvedValue([canal(30)]);
    const r = await cron.process({} as any);
    expect(connect.refreshToken).not.toHaveBeenCalled();
    expect(r).toEqual({ verificados: 1, renovados: 0, falhas: 0 });
  });

  it('renova canal com 10 dias restantes e grava o novo vencimento', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000_000_000);
    repo.findActiveByType.mockResolvedValue([canal(10)]);
    connect.refreshToken.mockResolvedValue({ accessToken: 'NOVO', expiresIn: 5184000 });

    const r = await cron.process({} as any);

    expect(connect.refreshToken).toHaveBeenCalledWith('LONGO');
    expect(repo.update).toHaveBeenCalledWith(
      'ch_1',
      expect.objectContaining({
        config: expect.objectContaining({
          accessToken: 'NOVO',
          tokenExpiresAt: new Date(1_000_000_000_000 + 5184000 * 1000).toISOString(),
          refreshFailures: 0,
        }),
      }),
    );
    expect(r).toEqual({ verificados: 1, renovados: 1, falhas: 0 });
    jest.spyOn(Date, 'now').mockRestore();
  });

  it('em falha, notifica a org uma vez e NAO desativa o canal', async () => {
    repo.findActiveByType.mockResolvedValue([canal(10)]);
    connect.refreshToken.mockRejectedValue(new Error('token invalido'));

    const r = await cron.process({} as any);

    expect(notifications.notifyOrgAgents).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org_1', type: NotificationType.SYSTEM }),
    );
    // Desativar recriaria o apagão: canal inativo descarta inbound em silêncio.
    const [, data] = repo.update.mock.calls[0];
    expect(data).not.toHaveProperty('isActive');
    expect(data.config.refreshFailures).toBe(1);
    expect(r).toEqual({ verificados: 1, renovados: 0, falhas: 1 });
  });

  it('respeita o throttle: nao notifica de novo dentro de 24h', async () => {
    repo.findActiveByType.mockResolvedValue([canal(10)]);
    connect.refreshToken.mockRejectedValue(new Error('token invalido'));
    redis.set.mockResolvedValue(null); // chave de throttle já existe

    await cron.process({} as any);

    expect(notifications.notifyOrgAgents).not.toHaveBeenCalled();
  });

  it('ignora canal sem tokenExpiresAt sem quebrar a varredura', async () => {
    repo.findActiveByType.mockResolvedValue([
      { id: 'ch_sem', organizationId: 'org_1', name: 'antigo', config: { accessToken: 'X' } },
      canal(30),
    ]);
    const r = await cron.process({} as any);
    expect(r.verificados).toBe(2);
    expect(r.falhas).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
npx jest src/modules/channel-hub/adapters/instagram/instagram-token-refresh.cron.spec.ts
```

Esperado: FAIL — `Cannot find module './instagram-token-refresh.cron'`.

- [ ] **Step 3: Implementar o cron**

Criar `instagram-token-refresh.cron.ts`:

```ts
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import { ChannelType, NotificationType } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import { ChannelsRepository } from '../../channels/channels.repository';
import { NotificationsService } from '../../../notifications/notifications.service';
import { InstagramConnectService } from './instagram-connect.service';
import { InstagramPlatformConfigService } from './instagram-platform-config.service';
import { IG_OAUTH_REDIS } from './instagram-oauth-state.service';
import { IG_TOKEN_REFRESH_QUEUE, IG_TOKEN_REFRESH_JOB } from './instagram.constants';

const DIA_MS = 24 * 60 * 60 * 1000;
/** Um alerta por canal por dia. Canal quebrado não pode virar 60 notificações. */
const THROTTLE_ALERTA_SEGUNDOS = 24 * 60 * 60;

/**
 * O token do Instagram vale 60 dias e, se ficar 60 dias sem uso nem renovação,
 * expira em DEFINITIVO — não dá pra renovar depois, só reconectando na mão.
 * Por isso a varredura é proativa e cobre todas as orgs, sem opt-in.
 *
 * Mesmo padrão do InactivityWatchdogCron: registra o job repeat no boot e
 * processa a varredura no worker.
 */
@Processor(IG_TOKEN_REFRESH_QUEUE, { concurrency: 1 })
export class InstagramTokenRefreshCron extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(InstagramTokenRefreshCron.name);
  private readonly pattern = process.env.IG_TOKEN_REFRESH_CRON ?? '0 4 * * *';

  constructor(
    @InjectQueue(IG_TOKEN_REFRESH_QUEUE) private readonly queue: Queue,
    private readonly channelsRepo: ChannelsRepository,
    private readonly connect: InstagramConnectService,
    private readonly notifications: NotificationsService,
    private readonly platform: InstagramPlatformConfigService,
    @Inject(IG_OAUTH_REDIS) private readonly redis: Redis,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.add(
        IG_TOKEN_REFRESH_JOB,
        {},
        {
          repeat: { pattern: this.pattern },
          jobId: 'instagram-token-refresh-cron',
          removeOnComplete: 10,
          removeOnFail: 10,
        },
      );
      this.logger.log(`instagram_token_refresh_registered pattern=${this.pattern}`);
    } catch (err) {
      this.logger.error(
        `Falha registrando o cron de refresh do Instagram: ${(err as Error).message}`,
      );
    }
  }

  async process(
    _job: Job,
  ): Promise<{ verificados: number; renovados: number; falhas: number }> {
    const canais = await this.channelsRepo.findActiveByType(ChannelType.INSTAGRAM);
    const limiteMs = this.platform.refreshThresholdDays * DIA_MS;
    let renovados = 0;
    let falhas = 0;

    for (const canal of canais) {
      const config = (canal.config ?? {}) as Record<string, any>;
      if (!config.tokenExpiresAt || !config.accessToken) continue;

      const restaMs = new Date(config.tokenExpiresAt).getTime() - Date.now();
      if (restaMs > limiteMs) continue;

      try {
        const novo = await this.connect.refreshToken(config.accessToken);
        await this.channelsRepo.update(canal.id, {
          config: {
            ...config,
            accessToken: novo.accessToken,
            tokenExpiresAt: new Date(Date.now() + novo.expiresIn * 1000).toISOString(),
            tokenRefreshedAt: new Date().toISOString(),
            refreshFailures: 0,
            lastRefreshError: null,
          },
        });
        renovados++;
        this.logger.log(`instagram_token_refreshed channel=${canal.id}`);
      } catch (err) {
        falhas++;
        const mensagem = (err as Error).message;
        const tentativas = Number(config.refreshFailures ?? 0) + 1;

        // O canal SEGUE ATIVO de propósito. Desativar faria o webhook descartar
        // inbound em silêncio — trocaríamos "não consigo responder" por "não
        // recebo nada e ninguém sabe", que foi o apagão do Comercial.
        await this.channelsRepo.update(canal.id, {
          config: { ...config, refreshFailures: tentativas, lastRefreshError: mensagem },
        });

        this.logger.error(
          `instagram_token_refresh_failed channel=${canal.id} tentativa=${tentativas}: ${mensagem}`,
        );
        await this.alertar(canal, restaMs, mensagem);
      }
    }

    return { verificados: canais.length, renovados, falhas };
  }

  private async alertar(
    canal: { id: string; organizationId: string; name: string },
    restaMs: number,
    mensagem: string,
  ): Promise<void> {
    const podeAlertar = await this.redis.set(
      `ig:token-alert:${canal.id}`,
      '1',
      'EX',
      THROTTLE_ALERTA_SEGUNDOS,
      'NX',
    );
    if (podeAlertar !== 'OK') return;

    const dias = Math.max(0, Math.floor(restaMs / DIA_MS));
    await this.notifications.notifyOrgAgents({
      organizationId: canal.organizationId,
      type: NotificationType.SYSTEM,
      title: `Instagram "${canal.name}": renovação automática falhou`,
      body:
        dias > 0
          ? `A conexão vence em ${dias} dia(s) e a renovação automática falhou. Reconecte em Configurações → Canais.`
          : 'A conexão venceu e a renovação automática falhou. Reconecte em Configurações → Canais.',
      data: { channelId: canal.id, erro: mensagem },
    });
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
npx jest src/modules/channel-hub/adapters/instagram/instagram-token-refresh.cron.spec.ts
```

Esperado: PASS, 5 testes.

- [ ] **Step 5: Registrar no módulo**

Em `src/modules/channel-hub/channel-hub.module.ts`:

Acrescentar aos imports do arquivo:

```ts
import { NotificationsModule } from '../notifications/notifications.module';
import { InstagramTokenRefreshCron } from './adapters/instagram/instagram-token-refresh.cron';
import { IG_TOKEN_REFRESH_QUEUE } from './adapters/instagram/instagram.constants';
```

Acrescentar `{ name: IG_TOKEN_REFRESH_QUEUE }` à lista do `BullModule.registerQueue(...)`, e `NotificationsModule` ao array `imports:`.

Acrescentar `InstagramTokenRefreshCron` ao array `providers:`.

- [ ] **Step 6: Compilar e rodar o portão de ciclo de DI**

```bash
npx tsc --noEmit
npx jest src/common/architecture/di-cycle-guard.spec.ts
```

Esperado: ambos PASS. Se o guard falhar, o `NotificationsModule` fechou ciclo com o `ChannelHubModule` — envolver em `forwardRef(() => NotificationsModule)`.

- [ ] **Step 7: Commit**

```bash
git add src/modules/channel-hub/adapters/instagram/instagram-token-refresh.cron.ts \
        src/modules/channel-hub/adapters/instagram/instagram-token-refresh.cron.spec.ts \
        src/modules/channel-hub/channel-hub.module.ts
git commit -m "feat(instagram): cron de renovacao do token com alerta a org"
```

---

## Task 7: Env e runbook

**Files:**
- Modify: `.env.example`
- Create: `docs/instagram-oauth-runbook.md`

- [ ] **Step 1: Documentar o env**

Acrescentar ao fim de `.env.example`:

```bash
# ─── Instagram (OAuth "Instagram API with Instagram Login") ───
# O Instagram tem App ID/Secret PRÓPRIOS dentro do mesmo app Meta que hospeda o
# WhatsApp. Ficam na página do produto Instagram, NÃO em Configurações → Básico,
# e NÃO são os WA_*.
IG_APP_ID=
IG_APP_SECRET=
# Precisa bater caractere por caractere com a OAuth redirect URI cadastrada na Meta.
IG_REDIRECT_URI=https://api-ofpchat.explotek.pro/api/v1/channels/instagram/callback
IG_API_VERSION=v24.0
# Segredo do HMAC do `state` do OAuth. Qualquer string aleatória longa.
IG_STATE_SECRET=
# Hosts (sem esquema) para os quais o callback pode redirecionar de volta.
# Conferir no Caddy do VPS quais domínios servem o web de fato.
IG_RETURN_ALLOWLIST=sendtur.com.br
# Cron de renovação do token e antecedência em dias.
IG_TOKEN_REFRESH_CRON=0 4 * * *
IG_TOKEN_REFRESH_THRESHOLD_DAYS=15
```

- [ ] **Step 2: Escrever o runbook**

Criar `docs/instagram-oauth-runbook.md`:

```markdown
# Runbook — Conectar Instagram (OAuth)

## Configuração na Meta (uma vez)

1. Abrir o app Meta que já hospeda o WhatsApp em developers.facebook.com.
2. Adicionar o produto **Instagram** → "API setup with Instagram business login".
3. Copiar o **Instagram App ID** e o **Instagram App Secret** dessa página.
   Não são os do WhatsApp e não são os de Configurações → Básico.
4. Em "Business login settings", cadastrar a OAuth redirect URI:
   `https://api-ofpchat.explotek.pro/api/v1/channels/instagram/callback`
   Caractere por caractere — sem barra no fim, com https.
5. Em Webhooks, assinar os campos `messages`, `messaging_postbacks`, `messaging_seen`.
6. Preencher `IG_*` no `docker-compose.yml` do VPS (que não é versionado) e subir
   com `docker compose up -d` — `restart` não relê o env.

## Testar antes do App Review

Em modo de desenvolvimento o app funciona com contas que tenham papel de
admin/dev/tester nele. Dá para fazer o E2E inteiro com a conta da OFP antes de
submeter — e o screencast do review sai desse mesmo E2E.

## App Review

Submeter as três permissões de uma vez:
`instagram_business_basic`, `instagram_business_manage_messages`,
`instagram_business_manage_comments`.

## Diagnóstico

| Sintoma | Causa provável |
|---|---|
| Botão "Conectar Instagram" não aparece | `isConfigured` falso — falta algum `IG_*` no container |
| Volta com `motivo=state_invalido` | `IG_STATE_SECRET` mudou entre o /authorize e o /callback, ou o link foi reusado |
| Volta com `motivo=sem_conta_business` | A conta do Instagram é pessoal, não profissional |
| Volta com `motivo=falha_inscricao` | Falta a permissão de mensagens, ou o token não cobre a conta |
| Conectou mas não chega mensagem | Conferir se o `subscribed_apps` passou e se o `igBusinessId` do canal bate com o `entry.id` do webhook em `webhook_events` |
```

- [ ] **Step 3: Commit**

```bash
git add .env.example docs/instagram-oauth-runbook.md
git commit -m "docs(instagram): env novo e runbook de configuracao na Meta"
```

---

## Task 8: Web — método no service

**Files:**
- Modify: `chat-bullq-web/src/features/channels/services/channels.service.ts`

- [ ] **Step 1: Criar a branch do web**

```bash
cd ../chat-bullq-web
git fetch fork
git checkout -b feat/instagram-oauth-connect fork/feat/conversation-tabs
```

- [ ] **Step 2: Adicionar o método**

Ao fim de `src/features/channels/services/channels.service.ts`, dentro do objeto de serviço exportado. O envelope é `{ data }` e os vizinhos desembrulham com `data.data` (ver `list()` na linha 80 e `create()` na linha 90) — este método segue o mesmo formato:

```ts
  /**
   * Pede à API a URL de autorização do Instagram. O `state` é assinado no
   * servidor, então o front não monta essa URL — só navega pra ela.
   */
  async getInstagramAuthorizeUrl(returnTo: string): Promise<string> {
    const { data } = await api.get<{ data: { url: string } }>(
      '/channels/instagram/authorize',
      { params: { returnTo } },
    );
    return data.data.url;
  },
```

- [ ] **Step 3: Compilar**

```bash
npx tsc --noEmit
```

Esperado: sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/features/channels/services/channels.service.ts
git commit -m "feat(web): metodo para pedir a URL de autorizacao do Instagram"
```

---

## Task 9: Web — botão "Conectar Instagram" e toast na volta

**Files:**
- Modify: `chat-bullq-web/src/features/channels/components/create-channel-dialog.tsx`
- Modify: `chat-bullq-web/src/app/(dashboard)/settings/channels/page.tsx`

- [ ] **Step 1: Adicionar o botão ao diálogo**

Em `create-channel-dialog.tsx`, no bloco `selectedType === 'INSTAGRAM'`, inserir **acima** do `<form>` existente (que continua funcionando como fallback):

```tsx
{/* Caminho principal: OAuth. O formulário abaixo fica como escotilha
    quando o OAuth quebra ou quando é preciso colar um token específico. */}
<button
  type="button"
  onClick={async () => {
    try {
      setConnecting(true);
      const url = await channelsService.getInstagramAuthorizeUrl(
        `${window.location.origin}/settings/channels`,
      );
      window.location.href = url;
    } catch {
      toast.error('Não foi possível iniciar a conexão com o Instagram.');
      setConnecting(false);
    }
  }}
  disabled={connecting}
  className="flex w-full items-center justify-center gap-2 rounded-md bg-gradient-to-r from-[#833AB4] via-[#E1306C] to-[#F77737] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
>
  <InstagramIcon className="h-4 w-4" />
  {connecting ? 'Abrindo o Instagram…' : 'Conectar Instagram'}
</button>

<div className="my-4 flex items-center gap-3 text-xs text-zinc-400">
  <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
  ou configure manualmente
  <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
</div>
```

Declarar o estado no topo do componente:

```tsx
const [connecting, setConnecting] = useState(false);
```

O arquivo já importa `toast` de `sonner` (linha 7) e já usa `useState` — nenhum
import novo além de `channelsService` e do `InstagramIcon`, que também já está lá
(é usado na lista de tipos de canal, linha 30).

- [ ] **Step 2: Mostrar o resultado na volta**

Em `src/app/(dashboard)/settings/channels/page.tsx`, acrescentar:

```tsx
const searchParams = useSearchParams();
const router = useRouter();

useEffect(() => {
  const ig = searchParams.get('ig');
  if (!ig) return;

  if (ig === 'ok') {
    toast.success('Instagram conectado!');
  } else {
    const motivos: Record<string, string> = {
      state_invalido: 'O link de conexão expirou. Tente de novo.',
      code_expirado: 'A autorização expirou no meio do caminho. Tente de novo.',
      permissao_negada: 'Você cancelou a autorização no Instagram.',
      sem_conta_business:
        'Essa conta do Instagram não é profissional. Converta para Comercial ou Criador de Conteúdo no app do Instagram e tente de novo.',
      falha_inscricao:
        'Conectamos a conta, mas não conseguimos assinar os webhooks. Fale com o suporte.',
      erro_interno: 'Algo deu errado ao conectar. Tente de novo.',
    };
    const motivo = searchParams.get('motivo') ?? 'erro_interno';
    toast.error(motivos[motivo] ?? motivos.erro_interno);
  }

  // Limpa a query pra um F5 não repetir o toast.
  router.replace('/settings/channels');
}, [searchParams, router]);
```

A página já é client component (`'use client'` na linha 1), então o efeito pode
morar nela direto. Importar `useEffect` do React, `useSearchParams`/`useRouter` de
`next/navigation` e `toast` de `sonner`.

- [ ] **Step 3: Compilar**

```bash
npx tsc --noEmit
npm run build
```

Esperado: sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/features/channels/components/create-channel-dialog.tsx \
        "src/app/(dashboard)/settings/channels/page.tsx"
git commit -m "feat(web): botao Conectar Instagram e retorno do OAuth"
```

---

## Task 10: Web — selo de token vencendo

**Files:**
- Modify: `chat-bullq-web/src/features/channels/components/channel-card.tsx`

- [ ] **Step 1: Adicionar o selo**

O arquivo já é client component e já importa `toast` de `sonner` (linha 20). O único
import novo é o `channelsService`. Dentro do corpo do componente:

```tsx
// O alerta de token vencido vai por notificação ao OWNER, mas quem abre esta
// tela precisa ver sem depender de notificação nenhuma.
const igTokenAviso = (() => {
  if (channel.type !== 'INSTAGRAM') return null;
  const expira = channel.config?.tokenExpiresAt;
  if (!expira) return null;
  const dias = Math.floor((new Date(expira).getTime() - Date.now()) / 86400000);
  if (dias > 15) return null;
  return dias <= 0
    ? { texto: 'Conexão expirada — reconecte', critico: true }
    : { texto: `Conexão vence em ${dias} dia${dias === 1 ? '' : 's'}`, critico: false };
})();
```

E no JSX, logo abaixo do nome do canal:

```tsx
{igTokenAviso && (
  <div
    className={`mt-2 flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs ${
      igTokenAviso.critico
        ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
        : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
    }`}
  >
    <span>{igTokenAviso.texto}</span>
    <button
      type="button"
      onClick={async () => {
        const url = await channelsService.getInstagramAuthorizeUrl(
          `${window.location.origin}/settings/channels`,
        );
        window.location.href = url;
      }}
      className="shrink-0 font-medium underline underline-offset-2"
    >
      Reconectar
    </button>
  </div>
)}
```

- [ ] **Step 2: Compilar**

```bash
npx tsc --noEmit && npm run build
```

Esperado: sem erro.

- [ ] **Step 3: Commit**

```bash
git add src/features/channels/components/channel-card.tsx
git commit -m "feat(web): selo de conexao do Instagram vencendo com botao reconectar"
```

---

## Task 11: Suíte completa e E2E manual

Esta é a task que decide se a fatia está pronta. O adapter de Instagram tem
~1.125 linhas que nunca foram provadas ponta a ponta com conta real.

- [ ] **Step 1: Rodar a suíte inteira da API**

```bash
cd ../.wt-instagram-oauth
npx jest
```

Esperado: verde. Se algum teste pré-existente quebrar, consertar antes de seguir —
não seguir com suíte vermelha.

- [ ] **Step 2: Subir local e conferir que a API sobe**

```bash
npm run start:dev
```

Esperado no log: `instagram_token_refresh_registered pattern=0 4 * * *` e nenhuma
`UndefinedDependencyException`.

- [ ] **Step 3: Configurar a Meta**

Seguir `docs/instagram-oauth-runbook.md`, seção "Configuração na Meta".

- [ ] **Step 4: E2E manual — a definição de pronto**

Marcar cada um:

- [ ] Botão "Conectar Instagram" aparece em Configurações → Canais
- [ ] Clicar leva à tela de autorização do Instagram
- [ ] Autorizar volta para o app com toast de sucesso
- [ ] O canal aparece na lista com o @ da conta como nome
- [ ] No banco, `config.igBusinessId` começa com `1784…` (e não com `256…`)
- [ ] Mandar um DM do celular → **a conversa aparece no inbox**
- [ ] Responder pelo inbox → **a resposta chega no celular**
- [ ] Rodar o cron à mão e confirmar que canal com 60 dias restantes não é tocado
- [ ] Corromper o `accessToken` de um canal de teste, rodar o cron, e confirmar:
      notificação chega, `refreshFailures` vira 1, e **o canal continua `isActive: true`**

Disparo manual do cron para os dois últimos itens:

```bash
npx ts-node -e "
  const { Queue } = require('bullmq');
  const q = new Queue('instagram-token-refresh', { connection: { host: 'localhost', port: 6379 } });
  q.add('refresh-instagram-tokens', {}).then(() => process.exit(0));
"
```

- [ ] **Step 5: Abrir os PRs**

```bash
cd ../.wt-instagram-oauth
git push -u origin feat/instagram-oauth-connect
gh pr create --base feat/conversation-tabs \
  --title "feat(instagram): conectar conta em 1 clique via OAuth" \
  --body "$(cat <<'EOF'
Substitui o formulário de token colado à mão por OAuth ("Instagram API with
Instagram Login"), e mantém o token de 60 dias vivo sozinho.

## O que entra
- `GET /channels/instagram/authorize` — devolve a URL de autorização com `state` assinado
- `GET /channels/instagram/callback` — sem guard (quem chama é a Meta); a identidade
  vem do `state` HMAC de uso único
- `InstagramConnectService.connect()` — troca de code → token de 60 dias → `/me` →
  `subscribed_apps` → upsert do canal por `igBusinessId`
- `InstagramTokenRefreshCron` — renova a <=15 dias do vencimento; em falha, avisa a
  org (throttle de 24h) e **não desativa o canal**

## Decisões que valem revisão
- Callback na API, não no web: uma única `redirect_uri` serve todos os white-labels.
- O `igBusinessId` vem do `/me?fields=user_id`, **não** do `user_id` que acompanha o
  token — é o que casa com o `entry.id` do webhook.
- Canal com token vencido segue `isActive: true` de propósito: desativar faria o
  webhook descartar inbound em silêncio (o apagão do Comercial).
- Os serviços novos são providers diretos do `ChannelHubModule`, não do
  `InstagramModule`, pelo mesmo motivo do `WhatsAppEmbeddedSignupService`: evitar
  ciclo de DI.

## Fora de escopo
Gate de janela 24h para IG (Fatia 1.5), comentário→DM e story (Fatia 2).

## Deploy
Exige os `IG_*` no `docker-compose.yml` do VPS (não versionado) e `up -d`, não `restart`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"

cd ../chat-bullq-web
git push -u origin feat/instagram-oauth-connect
gh pr create --base feat/conversation-tabs \
  --title "feat(web): botao Conectar Instagram" \
  --body "$(cat <<'EOF'
Par do PR da API. Botão "Conectar Instagram" em Configurações → Canais, toast no
retorno do OAuth, e selo de conexão vencendo com botão "Reconectar".

O formulário manual de token continua existindo como fallback.

Nenhuma variável `NEXT_PUBLIC_*` nova — o web só fala com a nossa API, então não
precisa mexer nos `ARG` do Dockerfile (que foi o que quebrou no Embedded Signup
do WhatsApp).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Nunca** mergear direto na branch viva sem PR. Depois do merge, conferir
ancestralidade de verdade — status "MERGED" de PR empilhado mente:

```bash
git merge-base --is-ancestor <sha> fork/feat/conversation-tabs && echo "na branch viva"
```

- [ ] **Step 6: Deploy**

Antes de subir, adicionar os `IG_*` ao `docker-compose.yml` do VPS (não versionado)
e usar `docker compose up -d` — `restart` não relê o env.

Rodar o `deploy-safe.sh` e conferir a sentinela. Sentinela sugerida: a string
`instagram_token_refresh_registered` no `dist` do container.

---

## Fora de escopo (não fazer aqui)

- Gate de janela de 24 h para Instagram — **Fatia 1.5**, antes de liberar para atendente
- Comentário → DM e gatilhos de story — Fatia 2
- Sync histórico via `instagram.sync-adapter.ts`
- Publicação de conteúdo
