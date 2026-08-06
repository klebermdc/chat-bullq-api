import { BadRequestException, Body, Controller, Optional, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { Feature } from '../../common/decorators';
import { EmailRenderService } from './email-render.service';
import { parseEmailContent } from './email-blocks.types';
import { EmailConfig, loadEmailConfig } from './email.config';
import { PreviewEmailDto } from './dto/preview-email.dto';

/** Nome de exemplo na prévia: `{{nome}}` vazio faria o texto parecer quebrado. */
const NOME_EXEMPLO = 'João';

@ApiTags('Email · Prévia')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Feature('email.view')
@Controller('email/preview')
export class PreviewController {
  private readonly config: EmailConfig;

  constructor(
    private readonly renderer: EmailRenderService,
    // `@Optional()` é obrigatório: `EmailConfig` é interface e some em runtime.
    // Sem ele o Nest tenta resolver o token `Object` e o boot morre — foi assim
    // que a API entrou em crashloop em 2026-08-04.
    @Optional() config?: EmailConfig,
  ) {
    this.config = config ?? loadEmailConfig(process.env);
  }

  @Post()
  @ApiOperation({ summary: 'Renderiza o HTML do email sem salvar nada' })
  async preview(@Body() dto: PreviewEmailDto) {
    let content;
    try {
      content = parseEmailContent(dto.content);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    // Link de descadastro é placeholder: não há destinatário. Mas precisa
    // aparecer, para o operador ver o rodapé real que vai sair.
    const { html } = await this.renderer.render(
      content,
      { nome: NOME_EXEMPLO, email: 'exemplo@destinatario.com' },
      '#',
      dto.preheader,
      `${this.config.apiUrl}/api/v1/email-assets`,
    );
    return { html };
  }
}
