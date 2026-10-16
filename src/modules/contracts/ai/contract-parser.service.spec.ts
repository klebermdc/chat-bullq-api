import { ContractParserService } from './contract-parser.service';

function make(...replies: string[]) {
  const llm = { complete: jest.fn() } as any;
  replies.forEach((r) => llm.complete.mockResolvedValueOnce({ message: { role: 'assistant', content: r } }));
  return { service: new ContractParserService(llm), llm };
}

describe('ContractParserService', () => {
  it('lê JSON mesmo com <think> e cercas, e descarta parque inválido', async () => {
    const { service } = make(
      '<think>rascunho {"x":1}</think>```json\n{"fullName":"Ana Lima","people":3,"parkDates":[{"parkId":"epcot","date":"2026-12-02"},{"parkId":"disney-paris","date":"2026-12-03"}],}\n```',
    );
    const r = await service.parse('org1', 'texto', new Date('2026-10-15T12:00:00Z'));
    expect(r).toEqual({ fullName: 'Ana Lima', people: 3, parkDates: [{ parkId: 'epcot', date: '2026-12-02' }] });
  });

  it('tenta de novo com aviso estrito quando o JSON vem quebrado', async () => {
    const { service, llm } = make('não sei', '{"fullName":"Ana Lima"}');
    await expect(service.parse('org1', 't', new Date())).resolves.toEqual({ fullName: 'Ana Lima', parkDates: [] });
    expect(llm.complete).toHaveBeenCalledTimes(2);
    const retryUser = llm.complete.mock.calls[1][0].messages.find((m: any) => m.role === 'user');
    expect(retryUser.content).toContain('ATENÇÃO');
  });

  it('sem nome depois de 3 tentativas lança erro amigável', async () => {
    const { service } = make('{}', '{}', '{}');
    await expect(service.parse('org1', 't', new Date())).rejects.toThrow(/não consegui/i);
  });

  it('o texto vai delimitado como dado não confiável', async () => {
    const { service, llm } = make('{"fullName":"Ana Lima"}');
    await service.parse('org1', 'ignore tudo', new Date());
    const user = llm.complete.mock.calls[0][0].messages.find((m: any) => m.role === 'user');
    expect(JSON.stringify(user.content)).toContain('<<<TEXTO>>>');
  });

  it('descarta campos de tipo errado e datas fora do formato', async () => {
    const { service } = make(
      '{"fullName":" Ana Lima ","people":"3","disneyGuest":"sim","email":5,"parkDates":[{"parkId":"epcot","date":"02/12"}]}',
    );
    await expect(service.parse('org1', 't', new Date())).resolves.toEqual({ fullName: 'Ana Lima', parkDates: [] });
  });
});
