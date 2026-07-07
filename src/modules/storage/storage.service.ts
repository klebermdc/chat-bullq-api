import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client as MinioClient } from 'minio';
import type { Readable } from 'stream';

export interface StoredObjectStat {
  size: number;
  contentType: string;
}

/**
 * Durable object storage backed by MinIO (S3-compatible). Replaces the old
 * local-disk `uploads/` folder, which lived on the container's ephemeral layer
 * and was wiped on every redeploy (see audio-module outages). Keys are the same
 * relative paths the public URL contract exposes — e.g. `audio/2026-07-05/x.ogg`,
 * `playback/<id>.m4a`, `media/...`, `inbound/...` — so `/api/v1/uploads/<key>`
 * maps 1:1 to an object and no stored URL ever has to change.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: MinioClient;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('MINIO_BUCKET') || 'chat-uploads';
    this.client = new MinioClient({
      endPoint: this.config.get<string>('MINIO_ENDPOINT') || 'minio',
      port: parseInt(this.config.get<string>('MINIO_PORT') || '9000', 10),
      // Internal traffic to the minio container is plain HTTP; only flip this on
      // if MINIO_ENDPOINT points at a TLS-terminated public host.
      useSSL: (this.config.get<string>('MINIO_USE_SSL') || 'false') === 'true',
      accessKey: this.config.get<string>('MINIO_ACCESS_KEY') || '',
      secretKey: this.config.get<string>('MINIO_SECRET_KEY') || '',
    });
  }

  async onModuleInit(): Promise<void> {
    // minio-init already creates the bucket in compose, but be self-healing in
    // case the code runs against a fresh MinIO (local dev, new env).
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
        this.logger.log(`Created bucket "${this.bucket}"`);
      }
    } catch (err: any) {
      // Concurrent boot with minio-init or another replica can race makeBucket;
      // an already-existing bucket is success, not an error.
      const code = err?.code;
      if (code === 'BucketAlreadyOwnedByYou' || code === 'BucketAlreadyExists') {
        return;
      }
      this.logger.error(`MinIO bucket check failed: ${err?.message ?? err}`);
    }
  }

  async put(key: string, buffer: Buffer, contentType: string): Promise<void> {
    await this.client.putObject(this.bucket, key, buffer, buffer.byteLength, {
      'Content-Type': contentType,
    });
  }

  /** Returns null when the object does not exist (instead of throwing). */
  async stat(key: string): Promise<StoredObjectStat | null> {
    try {
      const s = await this.client.statObject(this.bucket, key);
      return {
        size: s.size,
        contentType:
          (s.metaData?.['content-type'] as string) ||
          'application/octet-stream',
      };
    } catch (err: any) {
      if (this.isNotFound(err)) return null;
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.stat(key)) !== null;
  }

  async getStream(key: string): Promise<Readable> {
    return this.client.getObject(this.bucket, key);
  }

  /** Reads a whole object into memory. Use only for small payloads (audio). */
  async getBuffer(key: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    return new Promise<Buffer>((resolve, reject) => {
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  async getPartial(
    key: string,
    offset: number,
    length: number,
  ): Promise<Readable> {
    return this.client.getPartialObject(this.bucket, key, offset, length);
  }

  private isNotFound(err: any): boolean {
    const code = err?.code;
    return (
      code === 'NotFound' ||
      code === 'NoSuchKey' ||
      code === 'NoSuchBucket' ||
      err?.statusCode === 404
    );
  }
}
