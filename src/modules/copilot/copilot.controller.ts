import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CONSULT_IMAGE_MAX_BYTES,
  CONSULT_IMAGE_TYPES,
} from './consult/consult-prompt';
import { OrgRole } from '@prisma/client';
import { CopilotService } from './copilot.service';
import { AskDto } from './dto/ask.dto';
import { ConsultDto } from './dto/consult.dto';
import { CopilotConsultService } from './consult/copilot-consult.service';
import {
  CurrentOrg,
  CurrentUser,
  CurrentUserRole,
  Feature,
  Roles,
} from '../../common/decorators';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';

@ApiTags('Copilot (interno)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('copilot')
export class CopilotController {
  constructor(
    private readonly copilot: CopilotService,
    private readonly consultService: CopilotConsultService,
  ) {}

  @Post('ask')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Pergunta ao Copiloto interno (só OWNER/ADMIN)' })
  ask(@CurrentOrg('id') orgId: string, @Body() dto: AskDto) {
    return this.copilot.ask(orgId, dto.text, dto.history ?? []);
  }

  @Post('consult')
  @Feature('copilot.view')
  @ApiOperation({
    summary:
      'Consulta para o vendedor com o conhecimento da IA de atendimento (todos os logados)',
  })
  consult(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Body() dto: ConsultDto,
  ) {
    return this.consultService.consult(orgId, { id: userId, role }, dto);
  }

  @Post('consult/image')
  @Feature('copilot.view')
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: CONSULT_IMAGE_MAX_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Consulta com um print anexado (campo image)' })
  async consultWithImage(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Body() body: Record<string, string | undefined>,
    @UploadedFile() file?: { buffer: Buffer; mimetype: string },
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Anexe uma imagem.');
    }
    if (!(CONSULT_IMAGE_TYPES as readonly string[]).includes(file.mimetype)) {
      throw new BadRequestException('Use uma imagem JPG, PNG ou WEBP.');
    }
    const dto = await parseMultipartConsult(body);
    return this.consultService.consult(
      orgId,
      { id: userId, role },
      {
        ...dto,
        image: { mediaType: file.mimetype, data: file.buffer.toString('base64') },
      },
    );
  }
}

/** Multipart chega como texto: `history` vem em JSON e passa pela mesma validação do JSON. */
async function parseMultipartConsult(
  body: Record<string, string | undefined>,
): Promise<ConsultDto> {
  let history: unknown;
  try {
    history = body.history ? JSON.parse(body.history) : undefined;
  } catch {
    throw new BadRequestException('Histórico inválido.');
  }
  const dto = plainToInstance(ConsultDto, {
    text: body.text,
    conversationId: body.conversationId || undefined,
    messageId: body.messageId || undefined,
    history,
  });
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) throw new BadRequestException('Pergunta inválida.');
  return dto;
}
