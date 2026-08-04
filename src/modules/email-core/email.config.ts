export interface EmailConfig {
  apiKey: string;
  webhookSecret: string;
  from: string;
  unsubscribeSecret: string;
  publicUrl: string;
  apiUrl: string;
}

const REQUIRED = [
  'RESEND_API_KEY',
  'RESEND_WEBHOOK_SECRET',
  'EMAIL_FROM',
  'EMAIL_UNSUBSCRIBE_SECRET',
  'APP_PUBLIC_URL',
  'API_PUBLIC_URL',
] as const;

/**
 * Lê as variáveis de email e falha alto se faltar alguma.
 *
 * O `environment:` do docker-compose é lista explícita: variável esquecida lá
 * não chega no contêiner. Sem esta checagem, o sintoma apareceria só no primeiro
 * disparo de campanha, em produção.
 *
 * `publicUrl` (web, `ofpchat.explotek.pro`) e `apiUrl` (API,
 * `api-ofpchat.explotek.pro`) são domínios DIFERENTES em produção — não é
 * um único app num domínio só. Tratá-los como a mesma URL faz um dos dois
 * links de descadastro do email apontar para o domínio errado e devolver
 * 404 (veja `email-sender.service.ts`), o que os provedores de email
 * interpretam como sinal de spam.
 */
export function loadEmailConfig(env: Record<string, string | undefined>): EmailConfig {
  const missing = REQUIRED.filter((k) => !env[k] || !env[k]!.trim());
  if (missing.length) {
    throw new Error(
      `[email] variáveis de ambiente ausentes: ${missing.join(', ')}. ` +
        `Confira o bloco "environment:" do docker-compose.yml — ele é lista explícita.`,
    );
  }
  return {
    apiKey: env.RESEND_API_KEY!.trim(),
    webhookSecret: env.RESEND_WEBHOOK_SECRET!.trim(),
    from: env.EMAIL_FROM!.trim(),
    unsubscribeSecret: env.EMAIL_UNSUBSCRIBE_SECRET!.trim(),
    publicUrl: env.APP_PUBLIC_URL!.trim().replace(/\/+$/, ''),
    apiUrl: env.API_PUBLIC_URL!.trim().replace(/\/+$/, ''),
  };
}
