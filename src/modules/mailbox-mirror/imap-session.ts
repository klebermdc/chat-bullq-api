import { Injectable, Logger } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import type { SyncSearch } from './sync-plan';

const FALLBACK_FOLDER = 'INBOX';
const ALL_MAIL_FLAG = '\\All';
const SOCKET_TIMEOUT_MS = 120_000;

export interface ImapConnectionConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

export interface FolderState {
  uidValidity: bigint;
  uidNext: number;
}

/** O pouco de IMAP que a sincronização usa — fácil de trocar nos testes. */
export interface ImapSession {
  connect(): Promise<void>;
  resolveFolder(preferred: string | null): Promise<string>;
  open(folder: string): Promise<FolderState>;
  search(query: SyncSearch): Promise<number[]>;
  fetchSource(uid: number): Promise<Buffer | null>;
  close(): Promise<void>;
}

/**
 * Pasta a espelhar: a configurada, se existir; senão a marcada `\All`
 * (no Gmail o nome muda com o idioma: "All Mail", "Todos os e-mails");
 * senão INBOX (Hostinger/Zoho não têm "todos os e-mails").
 */
export function pickFolder(
  folders: ReadonlyArray<{ path: string; specialUse?: string }>,
  preferred: string | null,
): string {
  if (preferred && folders.some((f) => f.path === preferred)) return preferred;
  return folders.find((f) => f.specialUse === ALL_MAIL_FLAG)?.path ?? FALLBACK_FOLDER;
}

class ImapFlowSession implements ImapSession {
  constructor(private readonly client: ImapFlow) {}

  connect(): Promise<void> {
    return this.client.connect();
  }

  async resolveFolder(preferred: string | null): Promise<string> {
    return pickFolder(await this.client.list(), preferred);
  }

  async open(folder: string): Promise<FolderState> {
    // readOnly: espelho nunca marca e-mail como lido nem mexe na caixa.
    const box = await this.client.mailboxOpen(folder, { readOnly: true });
    return { uidValidity: box.uidValidity, uidNext: box.uidNext };
  }

  async search(query: SyncSearch): Promise<number[]> {
    const result = await this.client.search(query, { uid: true });
    return Array.isArray(result) ? result : [];
  }

  async fetchSource(uid: number): Promise<Buffer | null> {
    // Uma por vez: anexo grande não enche a memória com o lote inteiro.
    const msg = await this.client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
    return msg && msg.source ? msg.source : null;
  }

  async close(): Promise<void> {
    try {
      await this.client.logout();
    } catch {
      this.client.close?.();
    }
  }
}

@Injectable()
export class ImapSessionFactory {
  private readonly logger = new Logger(ImapSessionFactory.name);

  create(config: ImapConnectionConfig): ImapSession {
    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.password },
      // Sem log do imapflow: não arriscar credencial ou conteúdo de e-mail no log.
      logger: false,
      socketTimeout: SOCKET_TIMEOUT_MS,
    });
    // Evento 'error' sem ouvinte derruba o processo Node inteiro (a API toda).
    // A falha de verdade chega pela promise da operação em curso.
    client.on('error', (err: Error) => {
      this.logger.warn(`conexão IMAP ${config.host} caiu: ${err.message}`);
    });
    return new ImapFlowSession(client);
  }
}
