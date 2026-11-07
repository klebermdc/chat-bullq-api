import { parseWebsiteLeadPayload } from './website-lead-payload';

/** Exemplos anonimizados no formato que o Elementor manda. */
const ADVANCED = {
  form: { id: 'e79d2c0', name: 'form_agendamento' },
  fields: {
    nome: { id: 'nome', type: 'text', title: 'Nome', value: 'Maria Teste' },
    email: { id: 'email', type: 'email', title: 'Email', value: 'maria@exemplo.com' },
    whatsapp: { id: 'whatsapp', type: 'tel', title: 'Whatsapp (DDD + Número)', value: '(11) 99999-0000' },
    ofp_src: { id: 'ofp_src', type: 'hidden', value: 'ig' },
    ofp_mdm: { id: 'ofp_mdm', type: 'hidden', value: 'paid' },
    fbclid: { id: 'fbclid', type: 'hidden', value: 'IwAR-teste' },
    gclid: { id: 'gclid', type: 'hidden', value: '' },
  },
  meta: {
    date: { title: 'Data', value: '7 de novembro de 2026' },
    page_url: {
      title: 'URL da página',
      value: 'https://orlandofastpass.com.br/?utm_source=ig&utm_medium=paid&utm_campaign=111&utm_content=333&utm_term=222&utm_id=111',
    },
    user_agent: { title: 'User Agent', value: 'Mozilla/5.0 teste' },
    remote_ip: { title: 'IP remoto', value: '200.200.200.200' },
  },
};

describe('parseWebsiteLeadPayload', () => {
  it('lê o formato "Advanced Data" (fields[id][value], form, meta)', () => {
    const p = parseWebsiteLeadPayload(ADVANCED);
    expect(p.name).toBe('Maria Teste');
    expect(p.email).toBe('maria@exemplo.com');
    expect(p.phoneRaw).toBe('(11) 99999-0000');
    expect(p.formId).toBe('e79d2c0');
    expect(p.formName).toBe('form_agendamento');
    expect(p.pageUrl).toContain('utm_source=ig');
    expect(p.userAgent).toBe('Mozilla/5.0 teste');
    expect(p.remoteIp).toBe('200.200.200.200');
    expect(p.hidden).toEqual({ ofp_src: 'ig', ofp_mdm: 'paid', fbclid: 'IwAR-teste' });
  });

  it('lê o formato simples (rótulo: valor) com Page URL e Remote IP', () => {
    const p = parseWebsiteLeadPayload({
      Nome: 'João',
      Email: 'joao@exemplo.com',
      'Whatsapp (DDD + Número)': '+5511988887777',
      ofp_src: 'google',
      fbclid: '',
      Date: 'November 7, 2026',
      'Page URL': 'https://orlandofastpass.com.br/guiamento-remoto/?utm_source=google',
      'User Agent': 'UA',
      'Remote IP': '1.2.3.4',
      'Powered by': 'Elementor',
    });
    expect(p.name).toBe('João');
    expect(p.phoneRaw).toBe('+5511988887777');
    expect(p.pageUrl).toContain('guiamento-remoto');
    expect(p.remoteIp).toBe('1.2.3.4');
    expect(p.hidden).toEqual({ ofp_src: 'google' });
    expect(p.formId).toBeNull();
  });

  it('aceita chaves achatadas (fields[nome][value]) quando o corpo não foi aninhado', () => {
    const p = parseWebsiteLeadPayload({
      'form[id]': '0883206',
      'form[name]': 'form_agendamento_guiamento',
      'fields[nome][value]': 'Ana',
      'fields[whatsapp][value]': '11977776666',
      'fields[utm_id][value]': '999',
      'meta[page_url][value]': 'https://orlandofastpass.com.br/guiamento-remoto/',
    });
    expect(p.formId).toBe('0883206');
    expect(p.name).toBe('Ana');
    expect(p.phoneRaw).toBe('11977776666');
    expect(p.hidden).toEqual({ utm_id: '999' });
    expect(p.pageUrl).toBe('https://orlandofastpass.com.br/guiamento-remoto/');
  });

  it('acha o telefone por rótulo (telefone/celular/phone) e por tipo tel', () => {
    expect(parseWebsiteLeadPayload({ Celular: '11 91234-5678' }).phoneRaw).toBe('11 91234-5678');
    expect(
      parseWebsiteLeadPayload({ fields: { field_x: { type: 'tel', value: '11 95555-4444' } } }).phoneRaw,
    ).toBe('11 95555-4444');
  });

  it('corpo vazio ou inválido não quebra', () => {
    const p = parseWebsiteLeadPayload(null);
    expect(p.phoneRaw).toBeNull();
    expect(p.hidden).toEqual({});
  });

  it('corta valores gigantes (não guarda lixo de spam)', () => {
    const p = parseWebsiteLeadPayload({ Nome: 'x'.repeat(5000), Whatsapp: '11999990000' });
    expect(p.name!.length).toBeLessThanOrEqual(200);
  });
});
