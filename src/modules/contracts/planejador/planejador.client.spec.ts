import { PlanejadorClient, buildPlanejadorPayload } from './planejador.client';

describe('buildPlanejadorPayload', () => {
  it('monta o payload do Lovable com datas sem fuso', () => {
    const p = buildPlanejadorPayload(
      {
        id: 'c1', fullName: 'Ana', cpf: '1', phone: '2', address: 'R', cep: '3', email: 'a@x.com',
        guideName: 'Kleber', amount: '2190,00', people: 4, disneyGuest: true,
      },
      [
        { parkId: 'epcot', label: 'EPCOT', date: '2026-12-02' },
        { parkId: 'magic-kingdom', label: 'Magic Kingdom', date: '2026-12-01' },
      ],
      'Senha#123',
    );
    expect(p).toMatchObject({
      email: 'a@x.com', password: 'Senha#123', contract_id: 'c1', quantidade_pessoas: '4', quantidade_dias: 2,
      hospede_disney: true, start_date: '2026-12-01', end_date: '2026-12-02',
    });
    expect(p.parks[0]).toEqual({
      date: '2026-12-01', park: 'Magic Kingdom', time_start: '08:00', time_end: '22:00', notes: 'Hóspede Disney',
    });
  });

  it('sem datas: start/end nulos e sem parques', () => {
    const p = buildPlanejadorPayload(
      { id: 'c1', fullName: 'A', cpf: '1', phone: '2', address: 'R', cep: '3', email: 'a@x.com', guideName: 'K', amount: '1', people: 1, disneyGuest: false },
      [],
      'x',
    );
    expect(p.start_date).toBeNull();
    expect(p.end_date).toBeNull();
    expect(p.parks).toEqual([]);
  });
});

describe('PlanejadorClient', () => {
  it('sem URL configurada lança erro claro', async () => {
    await expect(new PlanejadorClient({} as any, jest.fn()).createClient({} as any)).rejects.toThrow(
      /PLANEJADOR_CREATE_CLIENT_URL/,
    );
  });

  it('erro HTTP vira exceção com status, sem ecoar o corpo inteiro', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 409, text: async () => 'x'.repeat(1000) });
    const c = new PlanejadorClient({ PLANEJADOR_CREATE_CLIENT_URL: 'https://p/x', PLANEJADOR_API_KEY: 'k' } as any, fetchFn);
    const err = await c.createClient({} as any).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/409/);
    expect((err as Error).message.length).toBeLessThan(260);
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Bearer k');
  });

  it('a mensagem de erro nunca contém o payload enviado', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const c = new PlanejadorClient({ PLANEJADOR_CREATE_CLIENT_URL: 'https://p/x' } as any, fetchFn);
    const err = await c.createClient({ password: 'Senha#123' } as any).catch((e: Error) => e);
    expect((err as Error).message).not.toContain('Senha#123');
  });

  it('usa timeout de 15s via AbortSignal e POST com JSON', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    const c = new PlanejadorClient({ PLANEJADOR_CREATE_CLIENT_URL: 'https://p/x' } as any, fetchFn);
    await c.createClient({ a: 1 } as any);
    expect(timeoutSpy).toHaveBeenCalledWith(15_000);
    expect(fetchFn.mock.calls[0][1].method).toBe('POST');
    expect(fetchFn.mock.calls[0][1].body).toBe('{"a":1}');
    timeoutSpy.mockRestore();
  });
});
