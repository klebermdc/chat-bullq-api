import type { QuoteTerms } from './quote/quote.types';

/**
 * Regras que valem para TODA cotação (página e PDF): o aviso de câmbio e a
 * política de cancelamento da Orlando Fast Pass, enviada pelo Kleber em
 * 27/10/2026. A política é uma só para o orçamento inteiro, não por item.
 */
export const QUOTE_TERMS: Readonly<QuoteTerms> = Object.freeze<QuoteTerms>({
  exchangeNotice:
    'Os ingressos são cobrados em dólar. Os valores em reais seguem o câmbio do dia e podem mudar a qualquer momento até a confirmação do pagamento.',
  cancellation: {
    title: 'Política de Cancelamento e Alterações',
    revisedAt: '27 de outubro de 2026',
    blocks: [
      {
        kind: 'p',
        text: 'A Orlando Fast Pass (CNPJ 33.142.150/0001-99) atua na intermediação da venda de ingressos e produtos turísticos, portanto, temos que respeitar as políticas de cancelamento e reembolso das atrações e de nossos fornecedores. No entanto, dado o nosso compromisso com a qualidade dos serviços prestados, iremos buscar a melhor solução possível para você, nosso cliente.',
      },
      {
        kind: 'p',
        text: 'O horário de funcionamento dos parques, atrações e entretenimentos podem variar, assim como estão sujeitos a fechamento por reformas, por temporada, ou devido às condições climáticas.',
      },
      {
        kind: 'p',
        text: 'As solicitações de alteração de datas e/ou cancelamento deverão ser realizadas por escrito, através do e-mail contato@orlandofastpass.com.br, onde deve ser enviado o número do pedido, os dados dos passageiros e os vouchers (se emitidos). Dúvidas: telefone (11) 5194-4192. Além disso, devem ser observadas as seguintes regras:',
      },
      {
        kind: 'list',
        items: [
          'Em acordo com o artigo 49 do Código de Defesa do Consumidor, pedidos de cancelamento ou alteração dos ingressos poderão ser realizados em até 07 (sete) dias corridos a partir da data da confirmação do pedido, desde que ainda não tenham sido emitidos.',
          'Caso opte pelo cancelamento dos ingressos ainda não emitidos, a solicitação do cancelamento deve ser feita até 1 dia antes do prazo para emissão dos ingressos.',
          'Caso a data e horário da atração adquirida esteja dentro deste período de sete dias, o pedido de cancelamento deverá ser efetuado pelo cliente em até 48 (quarenta e oito) horas antes do horário agendado para início da atração.',
        ],
      },
      {
        kind: 'p',
        text: 'Nesses casos, o cliente terá o reembolso de 90% do valor pago. Ou seja, será cobrado 10% de multa a título de despesas administrativas.',
      },
      {
        kind: 'p',
        text: 'Para solicitação de cancelamento de pedidos já emitidos e/ou após o prazo legal de 7 (sete) dias corridos, sendo possível o cancelamento, o cliente será informado das taxas a serem incorridas e qual o valor do reembolso após avaliação junto aos nossos fornecedores. O pedido de cancelamento só será concluído com a aprovação do cliente (sendo iniciado o processo de reembolso).',
      },
      {
        kind: 'p',
        text: 'Os valores a serem reembolsados serão estornados através do mesmo método de pagamento utilizado para conclusão da transação, seguindo os seguintes prazos e condições:',
      },
      {
        kind: 'list',
        items: [
          'Caso a compra tenha sido paga através de cartão de crédito, o procedimento de estorno será efetuado em até 2 (dois) dias úteis contados do recebimento do e-mail de confirmação do cancelamento. O crédito ao portador do cartão dependerá do processamento deste valor pelo banco emissor e da data de fechamento da fatura. O estorno poderá ser visualizado em até três faturas, prazo este que independe da Orlando Fast Pass, já que decorre dos procedimentos internos de cada administradora de cartão de crédito.',
          'Para pagamentos através de depósito em conta, Pix, boleto ou transferência bancária, o reembolso será feito através de depósito em conta no nome do comprador principal, com prazo máximo de 30 dias a contar a partir da confirmação do cancelamento.',
        ],
      },
      {
        kind: 'p',
        text: 'Será considerado como “No-show” o não comparecimento no dia, hora e local combinados para o início da atração sem aviso prévio, por quaisquer motivos, tais como impossibilidade de datas, problemas pessoais que impeçam a sua participação, outros compromissos, dentre outros casos dessa ordem. Nestes casos, não há possibilidade de reembolso em nenhuma hipótese.',
      },
    ],
  },
});
