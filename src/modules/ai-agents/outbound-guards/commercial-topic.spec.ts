// Adaptado de DeskcommCRM (https://github.com/melgarafael/DeskcommCRM), MIT License, Copyright (c) 2026 Rafael Melgaço.
import {
  contemAssuntoComercialNaSaida,
  contemAssuntoComercialRestrito,
} from './commercial-topic';

describe('valores e negociação somente humanos', () => {
  it.each([
    'Quanto custa?', 'Qual o preço dos óculos?', 'Tem desconto?', 'Pode parcelar?',
    'Passa o Pix', 'Quero um orçamento', 'Está grátis?', 'A promoção vale?', 'R$ 199,90',
    'Tenho boleto', 'Quero pagar', 'Preciso de reembolso',
    'Está caro', 'Aceptan pago con tarjeta?', 'Qual o valor?', 'Condição de crédito', 'Fica 299',
    'A partir de 199', '299,90', 'Quanto custa o óculos?', 'Fica R$ 250,00 em 3x',
    'Dá para fazer em 10x?', 'São 10x de 29,90', 'Quanto vocês cobram?',
    'Qual o valor da consulta?', 'Tem 10% off?',
  ])('não entrega condição comercial: %s', (s) => {
    expect(contemAssuntoComercialRestrito(s)).toBe(true);
  });

  it.each([
    'Rua das Flores, 2054', 'Avenida dos Exemplos, 1317', 'Sala 01', '(11) 4000-0000',
    'Abre às 8:30?', 'Quero o Maps', 'Falar com a unidade A', 'Bom dia', 'Tem armações?',
    'Segunda a sexta', 'Gostei do atendimento', 'dia 15.10 às 14.30', 'Abrimos às 9.00',
    'Tome 1 comprimido 2x ao dia', 'Estou com 40% de visão', 'O plano cobre isso?',
    'Me fala o valor nutricional', '15/10 às 14:30',
  ])('não confunde rotina/endereço com preço: %s', (s) => {
    expect(contemAssuntoComercialRestrito(s)).toBe(false);
  });

  it.each([
    'O total é 299.90 BRL', 'EUR 40', 'Total: 299.90 USD', 'O valor é 300',
    'Por 299.90 você leva', 'Leva por 299.90', '299.90 cada', 'cem euros', 'R$',
    'Hay descuento', 'En 3 cuotas', 'Cuesta 40', 'The price is 30', 'It costs 40',
    'We have a discount',
  ])('a saída barra o que a entrada deixa passar: %s', (s) => {
    expect(contemAssuntoComercialRestrito(s)).toBe(false);
    expect(contemAssuntoComercialNaSaida(s)).toBe(true);
  });

  it.each([
    'trezentos reais', 'Fica R$ 250,00 em 3x', 'Pagamento à vista',
    'Pode pagar no boleto ou pix', 'Qual o preço?', 'Tem desconto?', 'Em 3 parcelas',
  ])('a saída pega tudo que a entrada pega: %s', (s) => {
    expect(contemAssuntoComercialNaSaida(s)).toBe(true);
  });

  it.each([
    'Rua das Flores, 2054', 'Sala 01', '(11) 4000-0000', 'Abre às 8:30?', 'dia 15.10 às 14.30',
    'Abrimos às 9.00', 'Tome 1 comprimido 2x ao dia', 'Estou com 40% de visão', '15/10 às 14:30',
    'Seu horário ficou para 14.30, combinado?', 'Temos 3 unidades',
  ])('a saída não confunde rotina com preço: %s', (s) => {
    expect(contemAssuntoComercialNaSaida(s)).toBe(false);
  });
});

describe('valores que o redator escreve sem moeda nem vírgula', () => {
  it.each([
    'O investimento é de 2.500', 'Consigo fazer por 1.800 se fechar hoje',
    'Consigo fazer por 1800 se fechar hoje', 'Te faço 1800 se fechar hoje', '10 vezes sem juros',
    'Em 12 vezes no cartão', 'A mensalidade é 199', 'Son 500 pesos',
    'Os honorários ficam com o escritório', 'Tem cupom?', 'Dá um abatimento?', 'São 10 vezes de 29',
  ])('a saída barra: %s', (s) => {
    expect(contemAssuntoComercialNaSaida(s)).toBe(true);
  });

  it.each([
    'Nossa taxa de sucesso é de 90%', 'Seu retorno é 15 de outubro de 2026',
    'Já atendemos mais de 1.000 clientes', 'Tome 2 vezes ao dia', 'Venha 3 vezes por semana',
    'Treino com pesos livres', 'Atendemos de 14.30 às 18.00',
  ])('a saída não barra: %s', (s) => {
    expect(contemAssuntoComercialNaSaida(s)).toBe(false);
  });
});

describe('parcela na saída: só com contexto de pagamento', () => {
  it.each([
    '3x 600', '12x de 150', '12x150', 'Dá em até 6 vezes', '10 vezes 99', '12x 50',
    '3 vezes 200', '6x R$ 80', 'Dá 12x 50 pra você',
  ])('a saída barra: %s', (s) => {
    expect(contemAssuntoComercialNaSaida(s)).toBe(true);
  });

  it.each([
    'Você já remarcou 3 vezes', 'Ligamos 2 vezes e ninguém atendeu', 'Use 2 vezes diariamente',
    'Rua Augusta, 1500', 'CEP 01310-100', 'Traga uma foto 3x4', 'Faça 3x12 repetições',
    'Caminhe 2x 30 minutos', 'Venha 2x 14:30', 'Repita 2x 15 dias',
  ])('a saída não barra: %s', (s) => {
    expect(contemAssuntoComercialNaSaida(s)).toBe(false);
  });
});

// Casos de viagem (Sendtur/OFP): a Aline é SDR e não fala de valor nenhum.
describe('contexto de viagem', () => {
  it.each(['o ingresso custa R$ 699', 'em 10x sem juros', 'pagamento no Pix'])(
    'barra assunto comercial: %s',
    (s) => {
      expect(contemAssuntoComercialNaSaida(s)).toBe(true);
    },
  );

  it.each([
    'o parque abre às 9h', 'dia 15.10 às 14.30', 'são 4 parques', 'voo de 10 horas',
    'Vocês vão em março com 2 crianças, certo?', 'A Disney fica em Orlando.',
  ])('deixa passar fala de viagem: %s', (s) => {
    expect(contemAssuntoComercialNaSaida(s)).toBe(false);
  });
});
