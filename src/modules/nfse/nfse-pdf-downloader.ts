import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const PDF_MAGIC = '%PDF-';

/** Falha ao obter o PDF: vira 422 com a mensagem. */
export class NfsePdfError extends Error {}

const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [['::1', 128], ['fc00::', 7], ['fe80::', 10], ['::', 128], ['64:ff9b::', 96], ['ff00::', 8]] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv6');
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return PRIVATE.check(address, 'ipv4');
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    return mapped ? PRIVATE.check(mapped[1], 'ipv4') : PRIVATE.check(address, 'ipv6');
  }
  return true;
}

/** O link do Hub não pode apontar para a rede interna da VPS (minio, redis...). */
async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw new NfsePdfError('pdfUrl: endereço não encontrado.');
  if (addresses.some(isPrivateAddress)) throw new NfsePdfError('pdfUrl: endereço não permitido.');
}

async function readLimited(res: Response): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_PDF_BYTES) throw new NfsePdfError('PDF maior que 10 MB.');
  if (!res.body) throw new NfsePdfError('PDF vazio.');
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > MAX_PDF_BYTES) throw new NfsePdfError('PDF maior que 10 MB.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Baixa o PDF do link temporário do Hub (https, até 10 MB, 20 s) e confere
 * que é mesmo um PDF. Não segue redirecionamento: o link do Hub é direto.
 */
export async function downloadNfsePdf(rawUrl: string, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new NfsePdfError('pdfUrl: precisa ser https.');
  await assertPublicHost(url);

  let res: Response;
  try {
    res = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new NfsePdfError('Não foi possível baixar o PDF da NFS-e (link fora do ar ou lento).');
  }
  if (!res.ok) throw new NfsePdfError(`Não foi possível baixar o PDF da NFS-e (HTTP ${res.status}).`);

  const buffer = await readLimited(res);
  if (buffer.subarray(0, PDF_MAGIC.length).toString('latin1') !== PDF_MAGIC) {
    throw new NfsePdfError('O arquivo do pdfUrl não é um PDF.');
  }
  return buffer;
}
