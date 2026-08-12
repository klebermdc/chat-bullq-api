import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
// Namespace import, NÃO default. O tsconfig tem `allowSyntheticDefaultImports`
// (só relaxa a checagem de tipo) mas não tem `esModuleInterop` (que gera o
// helper de runtime). Com `import express from 'express'` o código compila
// limpo e emite `express_1.default`, que é `undefined` em runtime porque o
// express é CommonJS puro (`module.exports = express`, sem `.default`) — a API
// morria no boot com "Cannot read properties of undefined (reading 'static')".
// O `helmet` logo acima sobrevive como default porque publica `__esModule`.
import * as express from 'express';
import type { Request, Response } from 'express';
import { join } from 'path';
import { AppModule } from './app.module';
import { PublicApiModule } from './modules/public-api/public-api.module';
import { StorageService } from './modules/storage/storage.service';
import { isPubliclyServable } from './modules/storage/public-key.util';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { ErrorReporterService } from './modules/error-reporter/error-reporter.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // helmet blocks cross-origin media by default; relax that for <audio>/<img>
  // tags served by this API (same origin, but browsers enforce CORP).
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  // OBRIGATÓRIO para o rate limit funcionar. A API só é alcançável pelo Caddy
  // (o compose não publica a porta dela), então o X-Forwarded-For de um salto
  // é confiável. Sem isto, `req.ip` é o IP do container do proxy em TODA
  // requisição: o limite por IP trataria a internet inteira como um cliente
  // só e o primeiro visitante consumiria a cota de todos.
  app.set('trust proxy', 1);
  app.setGlobalPrefix('api/v1');

  // Serve uploads (audio, media) straight from MinIO. Registered pre-prefix
  // and without auth so the path matches in dev and behind the reverse-proxy,
  // and so external providers (Uazapi/WhatsApp) can download the file by URL.
  // Range support is required for Safari/iOS <audio>, which fetches media with
  // `Range: bytes=0-` and expects a 206 response.
  const storage = app.get(StorageService);
  app.use('/api/v1/uploads', async (req: Request, res: Response) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).end();
      return;
    }
    // req.path is the sub-path after the mount, e.g. "/audio/2026-07-05/x.ogg".
    const key = decodeURIComponent(req.path).replace(/^\/+/, '');
    // Allowlist de prefixos: esta rota não tem auth (a Meta e as tags
    // <img>/<audio> não mandam header), então ela NÃO pode servir o bucket
    // inteiro — que é único para todas as organizações. O PDF do aceite
    // assinado mora em `acceptances/` e era baixável sem sessão por aqui.
    // Ele agora sai por rotas próprias, escopadas: `/acceptances/:id/pdf`
    // (JWT + org) e `/public/acceptances/:token/pdf` (token do aceite).
    if (!isPubliclyServable(key)) {
      res.status(404).end();
      return;
    }
    try {
      const stat = await storage.stat(key);
      if (!stat) {
        res.status(404).end();
        return;
      }
      // Derive the type from the extension (we control the keys) so playback
      // never depends on MinIO's stored metadata — a wrong type on the .m4a
      // silently breaks Safari <audio>.
      res.setHeader('Content-Type', contentTypeFor(key, stat.contentType));
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      res.setHeader('Accept-Ranges', 'bytes');

      const rangeHeader = req.headers.range;
      const match = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader) : null;
      if (match) {
        let start = match[1] ? parseInt(match[1], 10) : 0;
        let end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
        if (Number.isNaN(start) || start < 0) start = 0;
        if (Number.isNaN(end) || end >= stat.size) end = stat.size - 1;
        const length = end - start + 1;
        if (start > end || length <= 0) {
          res.status(416).setHeader('Content-Range', `bytes */${stat.size}`);
          res.end();
          return;
        }
        if (req.method === 'HEAD') {
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
          res.setHeader('Content-Length', String(length));
          res.end();
          return;
        }
        // Acquire the stream BEFORE committing status/headers, so a failure to
        // open the object yields a clean 404 rather than a half-sent 206.
        const stream = await storage.getPartial(key, start, length);
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        res.setHeader('Content-Length', String(length));
        stream.on('error', () => res.destroy());
        stream.pipe(res);
        return;
      }

      if (req.method === 'HEAD') {
        res.setHeader('Content-Length', String(stat.size));
        res.end();
        return;
      }
      const stream = await storage.getStream(key);
      res.setHeader('Content-Length', String(stat.size));
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    } catch (err) {
      logger.error(`upload stream failed for "${key}": ${(err as Error).message}`);
      if (!res.headersSent) res.status(404).end();
      else res.destroy();
    }
  });
  // Ícones de redes sociais dos emails. Precisam de URL pública e estável:
  // já estão dentro de emails enviados, que não podem ser corrigidos depois.
  app.use('/api/v1/email-assets', express.static(join(__dirname, 'assets/email'), {
    maxAge: '365d',
    immutable: true,
  }));
  // CORS aceita uma LISTA de origens separada por vírgula em CORS_ORIGIN
  // (ex.: "https://ofpchat.explotek.pro,https://sendtur.com.br"). Passar a
  // string crua com vírgula quebra o header Access-Control-Allow-Origin e
  // derruba o app em TODOS os domínios — por isso o split(',').
  const corsOrigins = config
    .get<string>('CORS_ORIGIN', 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  // O reporter vem do container (ErrorReporterModule é @Global), mas o filtro
  // continua instanciado à mão — é assim que o Nest aplica filtro global sem
  // depender de APP_FILTER, e evita registro duplicado.
  app.useGlobalFilters(new GlobalExceptionFilter(app.get(ErrorReporterService)));
  app.useGlobalInterceptors(new LoggingInterceptor(), new ResponseInterceptor());

  const swagger = new DocumentBuilder()
    .setTitle('Chat BullQ API')
    .setDescription('Omnichannel customer service API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  // Dedicated public API docs — only the PublicApiModule surface, published
  // separately from the internal /docs.
  const publicSwagger = new DocumentBuilder()
    .setTitle('Chat BullQ — Public API')
    .setDescription(
      'API pública de integração (contatos, canais, conversas, mensagens). Autentique com Authorization: Bearer <API_KEY>.',
    )
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'Authorization', in: 'header' }, 'api-key')
    .build();
  const publicDoc = SwaggerModule.createDocument(app, publicSwagger, {
    include: [PublicApiModule],
  });
  SwaggerModule.setup('docs/public', app, publicDoc);

  const port = config.get<number>('PORT', 3001);
  await app.listen(port);
  logger.log(`API running on http://localhost:${port}`);
  logger.log(`Swagger docs at http://localhost:${port}/docs`);
  logger.log(`Public API docs at http://localhost:${port}/docs/public`);
}

// Maps our upload keys to a correct Content-Type from the extension. Falls
// back to whatever MinIO reported, then octet-stream. Kept in sync with the
// extensions UploadsService.extFor produces.
function contentTypeFor(key: string, fallback?: string): string {
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  const map: Record<string, string> = {
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    webm: 'audio/webm',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    '3gp': 'video/3gpp',
    pdf: 'application/pdf',
    zip: 'application/zip',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    csv: 'text/csv',
  };
  return map[ext] || fallback || 'application/octet-stream';
}

bootstrap();
