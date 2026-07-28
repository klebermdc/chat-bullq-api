import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiConsumes, ApiQuery } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { MediaLibraryService } from './media-library.service';
import { CreateFolderDto } from './dto/create-folder.dto';
import { UploadAssetDto } from './dto/upload-asset.dto';
import { UpdateFolderDto } from './dto/update-folder.dto';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser, CurrentUserRole, Feature } from '../../common/decorators';

@ApiTags('Media library')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('media-library')
export class MediaLibraryController {
  constructor(private readonly service: MediaLibraryService) {}

  // ----- folders -----
  @Get('folders')
  @ApiOperation({ summary: 'List folders' })
  listFolders(@CurrentOrg('id') orgId: string) {
    return this.service.listFolders(orgId);
  }

  @Post('folders')
  @ApiOperation({ summary: 'Create folder' })
  createFolder(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateFolderDto,
  ) {
    return this.service.createFolder(orgId, userId, dto);
  }

  @Patch('folders/:id')
  @ApiOperation({ summary: 'Rename folder / toggle sticker folder' })
  updateFolder(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @Body() dto: UpdateFolderDto,
  ) {
    return this.service.updateFolder(id, orgId, dto);
  }

  @Delete('folders/:id')
  @Feature('media.delete')
  @ApiOperation({ summary: 'Delete folder (assets stay, unassigned)' })
  deleteFolder(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
  ) {
    return this.service.deleteFolder(id, orgId, userId, role);
  }

  // ----- stickers -----
  @Get('stickers')
  @ApiOperation({ summary: 'List sticker assets (webp in sticker folders)' })
  listStickers(@CurrentOrg('id') orgId: string) {
    return this.service.listStickers(orgId);
  }

  // ----- assets -----
  @Get('assets')
  @ApiOperation({ summary: 'List assets (optionally by folder)' })
  @ApiQuery({ name: 'folderId', required: false })
  listAssets(
    @CurrentOrg('id') orgId: string,
    @Query('folderId') folderId?: string,
  ) {
    return this.service.listAssets(orgId, folderId);
  }

  @Post('assets')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MediaLibraryService.MAX_BYTES },
    }),
  )
  @ApiOperation({ summary: 'Upload a file into the library' })
  @ApiConsumes('multipart/form-data')
  async uploadAsset(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UploadAssetDto,
    @UploadedFile()
    file?: { buffer: Buffer; mimetype: string; originalname?: string },
  ) {
    if (!file) throw new BadRequestException('file is required');
    return this.service.uploadAsset(orgId, userId, file, dto);
  }

  @Delete('assets/:id')
  @Feature('media.delete')
  @ApiOperation({ summary: 'Delete an asset (owner or admin)' })
  deleteAsset(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
  ) {
    return this.service.deleteAsset(id, orgId, userId, role);
  }
}
