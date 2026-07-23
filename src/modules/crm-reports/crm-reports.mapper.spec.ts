import { dealsRowsToCsv } from './crm-reports.mapper';
import { CardStatus } from '@prisma/client';

describe('dealsRowsToCsv', () => {
  it('gera header + escapa vírgulas/aspas', () => {
    const csv = dealsRowsToCsv([
      {
        id: '1',
        contactName: 'Ana, Maria',
        pipelineName: 'Vendas',
        stageName: 'Proposta',
        status: CardStatus.WON,
        value: 1500,
        assignedToName: 'Pedro',
        createdAt: '2026-07-01T00:00:00.000Z',
        closedAt: null,
        closedReason: 'disse "sim"',
      },
    ]);
    const [header, row] = csv.split('\n');
    expect(header).toBe(
      'Cliente,Pipeline,Etapa,Status,Valor,Atendente,Criado,Fechado,Motivo',
    );
    expect(row).toContain('"Ana, Maria"');
    expect(row).toContain('"disse ""sim"""');
  });
});
