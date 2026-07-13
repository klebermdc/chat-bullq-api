import { Module } from '@nestjs/common';
import { MediaLibraryController } from './media-library.controller';
import { MediaLibraryService } from './media-library.service';
import { MediaLibraryRepository } from './media-library.repository';

@Module({
  controllers: [MediaLibraryController],
  providers: [MediaLibraryRepository, MediaLibraryService],
  exports: [MediaLibraryService],
})
export class MediaLibraryModule {}
