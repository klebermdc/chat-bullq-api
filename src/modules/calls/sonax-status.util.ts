import { CallStatus } from '@prisma/client';

const MAP: Record<string, CallStatus> = {
  discando: 'DIALING',
  andamento: 'RINGING',
  falando: 'TALKING',
  'ramal atendeu': 'ANSWERED',
  'ramal falhou': 'NO_ANSWER',
  ocupado: 'BUSY',
  indisponivel: 'NO_ANSWER',
  desligada: 'FINISHED',
};

function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos (combining marks)
    .trim();
}

export function mapSonaxStatus(
  statusChamada: string,
  statusAtendimento?: string,
): { status: CallStatus; answered: boolean } {
  const key = normalize(statusChamada);
  const status = MAP[key] ?? 'FINISHED';
  const answered = normalize(statusAtendimento ?? '') === 's' || status === 'ANSWERED';
  return { status, answered };
}
