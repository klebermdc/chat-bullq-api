import { PromptBuilderService } from './prompt-builder.service';

/**
 * Template HSM mandado pelo sistema (retorno do lead do site): o content é o
 * payload da Meta, sem texto. A Aline precisa ler o que foi perguntado —
 * "posso fazer duas rápidas perguntas?" — para entender o "Sim" do cliente.
 */
describe('PromptBuilderService — texto do template no histórico', () => {
  const builder = new PromptBuilderService();
  const extract = (m: any): string => (builder as any).extractText(m);

  it('usa metadata.renderedText quando o template não tem texto no content', () => {
    const text = extract({
      type: 'TEMPLATE',
      content: { name: 'lead_site_retorno', language: { code: 'pt_BR' } },
      metadata: { renderedText: 'Olá! Maria 👋 posso fazer duas rápidas perguntas?' },
    });
    expect(text).toContain('posso fazer duas rápidas perguntas?');
  });

  it('sem renderedText segue como antes', () => {
    expect(
      extract({ type: 'TEMPLATE', content: { name: 'x' }, metadata: {} }),
    ).toContain('[template sem texto extraído]');
  });
});
