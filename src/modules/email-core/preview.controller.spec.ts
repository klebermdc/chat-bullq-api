import { BadRequestException } from '@nestjs/common';
import { PreviewController } from './preview.controller';

const render = {
  render: jest.fn(
    async (_c: unknown, _v: unknown, _u: string, _p?: string, _a?: string) => ({
      html: '<html><body>Olá João</body></html>',
      text: 'Olá João',
    }),
  ),
};

describe('PreviewController', () => {
  const cfg = {
    apiKey: 'x', webhookSecret: 'x', from: 'a@b.com',
    unsubscribeSecret: 's', publicUrl: 'https://app.x', apiUrl: 'https://api.x',
  };
  const controller = new PreviewController(render as any, cfg as any);
  const valido = { content: { blocks: [{ type: 'text', text: 'Olá {{nome}}' }] } };

  beforeEach(() => render.render.mockClear());

  it('devolve o HTML renderizado', async () => {
    const r = await controller.preview(valido as any);
    expect(r.html).toContain('Olá João');
  });

  it('usa um nome de exemplo para as variáveis não saírem vazias na prévia', async () => {
    await controller.preview(valido as any);
    const vars = render.render.mock.calls[0][1] as { nome?: string };
    expect(vars.nome).toBeTruthy();
  });

  it('recusa conteúdo inválido explicando o motivo', async () => {
    await expect(controller.preview({ content: { blocks: [] } } as any)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('não persiste nada — só renderiza', async () => {
    await controller.preview(valido as any);
    expect(render.render).toHaveBeenCalledTimes(1);
  });
});
