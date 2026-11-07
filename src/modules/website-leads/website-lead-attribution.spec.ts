import { buildAttribution, classifyForm } from './website-lead-attribution';

describe('buildAttribution', () => {
  const NOW = new Date('2026-11-07T12:00:00.000Z');

  it('junta UTMs da URL da página com os campos ocultos ofp_*/fbclid/gclid', () => {
    const a = buildAttribution(
      {
        pageUrl:
          'https://orlandofastpass.com.br/?utm_source=ig&utm_medium=paid&utm_campaign=111&utm_content=333&utm_term=222&utm_id=111&fbclid=URL-CLID',
        referrer: null,
        hidden: { ofp_src: 'ig', ofp_cmp: 'bio', fbclid: 'HIDDEN-CLID' },
        formId: 'e79d2c0',
        formName: 'form_agendamento',
        userAgent: 'UA',
        remoteIp: '1.2.3.4',
      },
      NOW,
    );
    expect(a).toMatchObject({
      utm_source: 'ig',
      utm_medium: 'paid',
      utm_campaign: '111',
      utm_content: '333',
      utm_term: '222',
      utm_id: '111',
      ofp_src: 'ig',
      ofp_cmp: 'bio',
      fbclid: 'HIDDEN-CLID',
      page_url: expect.stringContaining('orlandofastpass'),
      form_id: 'e79d2c0',
      form_name: 'form_agendamento',
      submitted_at: NOW.toISOString(),
      ip: '1.2.3.4',
      user_agent: 'UA',
    });
  });

  it('usa o referrer quando a URL da página não tem query', () => {
    const a = buildAttribution(
      {
        pageUrl: 'https://orlandofastpass.com.br/',
        referrer: 'https://orlandofastpass.com.br/?utm_source=google&gclid=G1',
        hidden: {},
        formId: null,
        formName: null,
      },
      NOW,
    );
    expect(a.utm_source).toBe('google');
    expect(a.gclid).toBe('G1');
  });

  it('URL inválida não quebra e não inventa campo', () => {
    const a = buildAttribution(
      { pageUrl: 'não é url', referrer: null, hidden: {}, formId: null, formName: null },
      NOW,
    );
    expect(a.utm_source).toBeUndefined();
    expect(a.page_url).toBe('não é url');
  });
});

describe('classifyForm', () => {
  it('guiamento pelo id, nome ou página', () => {
    expect(classifyForm({ formId: '0883206', formName: null, pageUrl: null })).toBe('guiamento');
    expect(classifyForm({ formId: null, formName: 'form_agendamento_guiamento', pageUrl: null })).toBe('guiamento');
    expect(
      classifyForm({ formId: null, formName: null, pageUrl: 'https://x.com/guiamento-remoto/?a=1' }),
    ).toBe('guiamento');
  });

  it('o resto é o formulário principal', () => {
    expect(classifyForm({ formId: 'e79d2c0', formName: 'form_agendamento', pageUrl: 'https://x.com/' })).toBe('main');
  });

  it('o parâmetro ?form= da URL do webhook vence', () => {
    expect(classifyForm({ formId: 'e79d2c0', formName: null, pageUrl: null }, 'guiamento')).toBe('guiamento');
  });
});
