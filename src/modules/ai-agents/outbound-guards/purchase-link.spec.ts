import { contemLinkDeCompra } from './purchase-link';

describe('contemLinkDeCompra', () => {
  it.each([
    'Finaliza aqui: https://pay.kirvano.com/abc123',
    'https://orlandofastpass.com.br/checkout/ingresso-4-dias',
    'Segue o link https://orlandofastpass.com.br/pagamento?id=9',
    'https://loja.exemplo.com/carrinho',
    'https://exemplo.com/cart/123',
    'https://exemplo.com/comprar/disney',
    'https://pay.hotmart.com/X123',
    'https://exemplo.com/pix/qrcode',
    'https://exemplo.com/boleto/2a',
    'https://www.mercadopago.com.br/checkout/v1/redirect?pref=1',
    'www.exemplo.com/payment/1',
  ])('barra link de compra/pagamento: %s', (texto) => {
    expect(contemLinkDeCompra(texto)).toBe(true);
  });

  it.each([
    'https://orlandofastpass.com.br',
    'Veja os parques em https://orlandofastpass.com.br/parques/magic-kingdom',
    'https://orlandofastpass.com.br/blog/como-tirar-visto',
    'https://cotacao.orlandofastpass.com.br/c/abc123',
    'https://display.exemplo.com/compayment-info',
    'Sem link nenhum, só texto sobre pagamento',
  ])('deixa passar link que não é de compra: %s', (texto) => {
    expect(contemLinkDeCompra(texto)).toBe(false);
  });
});
