import {
  Controller,
  Delete,
  Get,
  Post,
  Body,
  Query,
  Param,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery, ApiConsumes } from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { ReactMessageDto } from './dto/react-message.dto';
import { TranscriptionService } from './transcription.service';
import { UploadsService } from './uploads.service';
import { MediaResolverService } from './media-resolver.service';
import { PlaybackService } from './playback.service';
import { SendMessageDto } from './dto/send-message.dto';
import {
  clampPageSize,
  DEFAULT_PAGE_SIZE,
  SEARCH_RESULT_LIMIT,
  WINDOW_RADIUS,
} from './message-paging';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import {
  CurrentUser,
  CurrentOrg,
  CurrentChannelAccess,
  CurrentUserRole,
} from '../../../common/decorators';
import type { ChannelAccess } from '../../iam/channel-access/channel-access.service';
import { OrgRole } from '@prisma/client';

@ApiTags('Messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('messages')
export class MessagesController {
  constructor(
    private readonly service: MessagesService,
    private readonly transcription: TranscriptionService,
    private readonly uploads: UploadsService,
    private readonly mediaResolver: MediaResolverService,
    private readonly playback: PlaybackService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Send a message (enqueues for delivery)' })
  send(
    @Body() dto: SendMessageDto,
    @CurrentUser('id') userId: string,
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @CurrentUserRole() role: OrgRole,
  ) {
    return this.service.send(dto, userId, orgId, access, role);
  }

  @Post(':id/react')
  @ApiOperation({ summary: 'React to a message with an emoji' })
  react(
    @Param('id') id: string,
    @Body() dto: ReactMessageDto,
    @CurrentUser('id') userId: string,
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @CurrentUserRole() role: OrgRole,
  ) {
    return this.service.react(id, dto.emoji, userId, orgId, access, role);
  }

  @Post('uploads/audio')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: UploadsService.MAX_AUDIO_BYTES },
    }),
  )
  @ApiOperation({ summary: 'Upload an audio file; returns public URL.' })
  @ApiConsumes('multipart/form-data')
  async uploadAudio(
    @UploadedFile()
    file?: { buffer: Buffer; mimetype: string; originalname?: string },
  ) {
    if (!file) throw new BadRequestException('file is required');
    return this.uploads.saveAudio({
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalname: file.originalname,
    });
  }

  @Post('uploads/media')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: UploadsService.MAX_MEDIA_BYTES },
    }),
  )
  @ApiOperation({
    summary:
      'Upload an image/video/document attachment; returns public URL.',
  })
  @ApiConsumes('multipart/form-data')
  async uploadMedia(
    @UploadedFile()
    file?: { buffer: Buffer; mimetype: string; originalname?: string },
  ) {
    if (!file) throw new BadRequestException('file is required');
    return this.uploads.saveMedia({
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalname: file.originalname,
    });
  }

  @Get(':id/media')
  @ApiOperation({
    summary:
      'Resolve a playable media URL for an inbound message. Cached after first call.',
  })
  async getMedia(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.mediaResolver.resolve(id, orgId, access, userId, role);
  }

  @Get(':id/playback')
  @ApiOperation({
    summary:
      'Resolve a cross-browser (AAC/M4A) playback URL for an audio message. ' +
      'Transcodes from OGG/Opus on first call (Safari/iOS cannot decode Opus) ' +
      'and caches the result.',
  })
  getPlayback(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.playback.getPlaybackUrl(id, orgId, access, userId, role);
  }

  @Post(':id/transcribe')
  @ApiOperation({
    summary:
      'Transcribe an audio message via Whisper. Cached in metadata.transcription.',
  })
  transcribe(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentChannelAccess() access: ChannelAccess,
    @Query('force') force?: string,
  ) {
    return this.transcription.transcribe(id, orgId, {
      force: force === 'true' || force === '1',
      access,
      currentUserId: userId,
      role,
    });
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      'Deletar mensagem pra todos. Tenta propagar pro provider — Zappfy suporta (some no app do cliente), Meta WA Cloud e Instagram não suportam (some só no Chat BullQ).',
  })
  revoke(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @CurrentUserRole() role: OrgRole,
  ) {
    return this.service.revokeForEveryone(id, orgId, userId, access, role);
  }

  @Get('search')
  @ApiOperation({
    summary:
      'Busca por conteúdo dentro da conversa (texto e legenda de mídia). Escopo inclui as conversas-irmãs de segmento.',
  })
  @ApiQuery({ name: 'conversationId', required: true })
  @ApiQuery({ name: 'q', required: true })
  @ApiQuery({ name: 'limit', required: false })
  searchInConversation(
    @Query('conversationId') conversationId: string,
    @Query('q') q: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentChannelAccess() access: ChannelAccess,
    @Query('limit') limit?: string,
  ) {
    return this.service.searchInConversation(
      conversationId,
      orgId,
      q,
      clampPageSize(limit, SEARCH_RESULT_LIMIT),
      access,
      userId,
      role,
    );
  }

  @Get('window')
  @ApiOperation({
    summary:
      'Janela de mensagens em volta de uma âncora — destino do "pular até" da busca.',
  })
  @ApiQuery({ name: 'conversationId', required: true })
  @ApiQuery({ name: 'anchorId', required: true })
  @ApiQuery({ name: 'radius', required: false })
  findWindowAround(
    @Query('conversationId') conversationId: string,
    @Query('anchorId') anchorId: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentChannelAccess() access: ChannelAccess,
    @Query('radius') radius?: string,
  ) {
    return this.service.findWindowAround(
      conversationId,
      orgId,
      anchorId,
      clampPageSize(radius, WINDOW_RADIUS),
      access,
      userId,
      role,
    );
  }

  @Get('contact-history/availability')
  @ApiOperation({
    summary:
      'Quantos atendimentos anteriores este cliente tem (outros protocolos e ' +
      'outros números com o mesmo telefone). O chat chama só quando o ' +
      'histórico da conversa atual acaba.',
  })
  @ApiQuery({ name: 'conversationId', required: true })
  contactHistoryAvailability(
    @Query('conversationId') conversationId: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.contactHistoryAvailability(
      conversationId,
      orgId,
      access,
      userId,
      role,
    );
  }

  @Get('contact-history')
  @ApiOperation({
    summary:
      'Mensagens anteriores à âncora atravessando os atendimentos anteriores ' +
      'do mesmo cliente — o "ver conversas anteriores" do chat.',
  })
  @ApiQuery({ name: 'conversationId', required: true })
  @ApiQuery({ name: 'before', required: true })
  @ApiQuery({ name: 'limit', required: false })
  findOlderInContactHistory(
    @Query('conversationId') conversationId: string,
    @Query('before') before: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentChannelAccess() access: ChannelAccess,
    @Query('limit') limit?: string,
  ) {
    if (!before) throw new BadRequestException('before is required');
    return this.service.findOlderInContactHistory(
      conversationId,
      orgId,
      before,
      clampPageSize(limit, DEFAULT_PAGE_SIZE),
      access,
      userId,
      role,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List messages of a conversation (paginated)' })
  @ApiQuery({ name: 'conversationId', required: true })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({
    name: 'before',
    required: false,
    description:
      'Id da mensagem âncora: devolve as ANTERIORES a ela (rolar pra cima). Ignora `page`.',
  })
  findByConversation(
    @Query('conversationId') conversationId: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentChannelAccess() access: ChannelAccess,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    // O cursor `before` e a paginação por `page` são caminhos distintos: o
    // chat usa o cursor, a public-api continua na página. Cursor manda quando
    // vem, pra não existir estado ambíguo.
    if (before) {
      return this.service.findOlderThan(
        conversationId,
        orgId,
        before,
        clampPageSize(limit, DEFAULT_PAGE_SIZE),
        access,
        userId,
        role,
      );
    }

    return this.service.findByConversation(
      conversationId,
      orgId,
      parseInt(page || '1', 10),
      clampPageSize(limit, DEFAULT_PAGE_SIZE),
      access,
      userId,
      role,
    );
  }
}
