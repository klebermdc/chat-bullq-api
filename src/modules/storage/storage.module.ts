import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Global so any module (and main.ts, via app.get) can inject StorageService
 * without an explicit import — mirrors how AutomationsModule is registered.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
