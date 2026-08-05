import {
  Controller,
  Get,
  Post,
  Param,
  HttpCode,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { SubscribersService } from '../email-audience/subscribers.service';
import { verifyUnsubscribeToken } from './unsubscribe-token.util';
import { EmailConfig, loadEmailConfig } from './email.config';

@ApiTags('Email · Descadastro')
@Controller('public/unsubscribe')
export class UnsubscribeController {
  private readonly config: EmailConfig;

  constructor(
    private readonly subscribers: SubscribersService,
    // `@Optional()` é obrigatório: `EmailConfig` é interface e some em runtime.
    @Optional() config?: EmailConfig,
  ) {
    this.config = config ?? loadEmailConfig(process.env);
  }

  private resolve(token: string): string {
    const id = verifyUnsubscribeToken(token, this.config.unsubscribeSecret);
    if (!id) throw new NotFoundException('link de descadastro inválido');
    return id;
  }

  @Get(':token')
  @Public()
  @ApiOperation({ summary: 'Consulta o destinatário do link (tela de confirmação)' })
  async peek(@Param('token') token: string) {
    const sub = await this.subscribers.findById(this.resolve(token));
    if (!sub) throw new NotFoundException('link de descadastro inválido');
    return { email: sub.email, status: sub.status };
  }

  @Post(':token')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Efetiva o descadastro (um clique, sem login)' })
  async confirm(@Param('token') token: string) {
    const id = this.resolve(token);
    // Sem sessão aqui — o token já identifica o destinatário. Buscamos o
    // registro (sem filtro de organização, o token É a autorização) só para
    // aprender a organização dele e repassar como checagem de coerência,
    // não de acesso.
    const existing = await this.subscribers.findById(id);
    if (!existing) throw new NotFoundException('link de descadastro inválido');
    const sub = await this.subscribers.unsubscribe(
      id,
      existing.organizationId,
      'clicou no link do email',
    );
    return { email: sub.email, status: sub.status };
  }
}
