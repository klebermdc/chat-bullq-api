import { Injectable } from '@nestjs/common';
import { render } from '@react-email/render';
import { EmailContent, EmailVariables, applyVariables } from './email-blocks.types';
import { BasicEmail } from './templates/basic-email';

export interface RenderedEmail {
  html: string;
  text: string;
}

@Injectable()
export class EmailRenderService {
  /**
   * Blocos + variáveis → HTML e texto puro.
   *
   * O link de descadastro é parâmetro obrigatório, não opcional: nenhum email
   * de marketing pode sair sem ele.
   */
  async render(
    content: EmailContent,
    variables: EmailVariables,
    unsubscribeUrl: string,
    preheader?: string,
    assetsBaseUrl?: string,
  ): Promise<RenderedEmail> {
    // Constrói blocos NOVOS em vez de mutar: o mesmo `content` é reusado para
    // cada destinatário da campanha, e mutar aqui contaminaria o próximo envio
    // com o nome do anterior.
    const blocks = content.blocks.map((block) => {
      switch (block.type) {
        case 'heading':
        case 'text':
          return { ...block, text: applyVariables(block.text, variables) };
        case 'button':
          return { ...block, label: applyVariables(block.label, variables) };
        default:
          return block;
      }
    });

    const element = BasicEmail({ blocks, theme: content.theme, preheader, unsubscribeUrl, assetsBaseUrl });
    const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
    return { html, text };
  }
}
