import { buildSecurityLayer, resolveSecurityRules } from './security.layer';

const LINHA_COMERCIAL =
  'Você não fala de valores, preços, descontos, parcelas ou pagamento; isso é com o consultor';

describe('resolveSecurityRules — blockCommercialTalk', () => {
  it('vem desligada por padrão (outras orgs não mudam)', () => {
    expect(resolveSecurityRules().blockCommercialTalk).toBe(false);
    expect(resolveSecurityRules({ customRules: ['x'] }).blockCommercialTalk).toBe(false);
  });

  it('liga só com booleano true', () => {
    expect(resolveSecurityRules({ blockCommercialTalk: true }).blockCommercialTalk).toBe(true);
    expect(
      resolveSecurityRules({ blockCommercialTalk: 'true' as unknown as boolean }).blockCommercialTalk,
    ).toBe(false);
  });
});

describe('camada de segurança — linha do assunto comercial', () => {
  it('aparece quando a regra está ligada', () => {
    const layer = buildSecurityLayer(resolveSecurityRules({ blockCommercialTalk: true }));
    expect(layer.content).toContain(LINHA_COMERCIAL);
  });

  it('não aparece quando está desligada', () => {
    const layer = buildSecurityLayer(resolveSecurityRules());
    expect(layer.content).not.toContain(LINHA_COMERCIAL);
  });
});
