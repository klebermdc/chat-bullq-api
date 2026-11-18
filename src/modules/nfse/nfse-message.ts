import { firstName } from '../scheduling/hsm-template-payload';

/** Nome da empresa no texto da nota. O endpoint existe para o Hub da OFP. */
export const NFSE_COMPANY_NAME = 'Orlando Fast Pass';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** "R$ 1.800,48" com espaço comum (o Intl põe um espaço não separável). */
export function formatBrl(valor: number): string {
  return BRL.format(valor).replace(/\s/g, ' ');
}

interface NfseTextInput {
  nome: string;
  numeroNfse: string;
  valor: number;
}

/** Mensagem que vai junto do PDF quando a janela de 24h está aberta. */
export function nfseMessageText({ nome, numeroNfse, valor }: NfseTextInput): string {
  const greeting = firstName(nome) ? `Olá, ${firstName(nome)}!` : 'Olá!';
  return (
    `${greeting} Segue a nota fiscal do seu guiamento com a ${NFSE_COMPANY_NAME} ` +
    `(NFS-e nº ${numeroNfse}, ${formatBrl(valor)}). Qualquer dúvida, é só responder aqui.`
  );
}

interface NfseTemplateInput extends NfseTextInput {
  templateName: string;
  language: string;
  pdfLink: string;
  pdfNome: string;
}

/**
 * Template da Meta para a janela fechada: o PDF vai no cabeçalho (DOCUMENT)
 * e o corpo tem {{1}} primeiro nome, {{2}} número da NFS-e e {{3}} valor.
 */
export function buildNfseTemplateContent(input: NfseTemplateInput): Record<string, unknown> {
  const text = (value: string) => ({ type: 'text', text: value.trim() || '-' });
  return {
    name: input.templateName,
    language: { code: input.language },
    components: [
      {
        type: 'header',
        parameters: [
          { type: 'document', document: { link: input.pdfLink, filename: input.pdfNome } },
        ],
      },
      {
        type: 'body',
        parameters: [
          text(firstName(input.nome)),
          text(input.numeroNfse),
          text(formatBrl(input.valor)),
        ],
      },
    ],
  };
}
