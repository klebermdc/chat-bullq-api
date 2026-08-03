/**
 * Áudio ANEXADO do dispositivo (não gravado no app) chega com os mimes que o
 * sistema operacional dá ao arquivo: iPhone manda `audio/x-m4a`, Android manda
 * `audio/3gpp`/`audio/amr`, e um arquivo baixado pode ser `audio/aac`. Nenhum
 * deles estava na whitelist — o anexo morria com 400 antes de chegar no
 * ffmpeg, embora o transcode pra MP3 desse conta de todos.
 */
jest.mock('child_process', () => ({
  execFile: jest.fn(
    (
      _file: string,
      _args: string[],
      _opts: unknown,
      cb: (err: unknown, res: { stdout: string; stderr: string }) => void,
    ) => cb(null, { stdout: '', stderr: '' }),
  ),
}));

import * as fs from 'fs';
import { BadRequestException } from '@nestjs/common';
import { UploadsService } from './uploads.service';

function makeService() {
  const storage = { put: jest.fn().mockResolvedValue(undefined) } as any;
  const config = {
    get: jest.fn().mockReturnValue('https://api-ofpchat.example'),
  } as any;
  return { svc: new UploadsService(config, storage), storage };
}

describe('UploadsService.saveAudio — áudio anexado do dispositivo', () => {
  let writeFile: jest.SpyInstance;

  beforeEach(() => {
    writeFile = jest
      .spyOn(fs.promises, 'writeFile')
      .mockResolvedValue(undefined);
    jest
      .spyOn(fs.promises, 'readFile')
      .mockResolvedValue(Buffer.from('MP3BYTES'));
    jest.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['audio/x-m4a', 'memo.m4a'], // gravador do iPhone
    ['audio/aac', 'trilha.aac'],
    ['audio/3gpp', 'gravacao.3gp'], // gravador do Android
    ['audio/amr', 'recado.amr'],
    ['audio/flac', 'master.flac'],
    ['audio/x-wav', 'nota.wav'],
  ])('aceita %s e devolve MP3', async (mimetype, originalname) => {
    const { svc, storage } = makeService();

    const result = await svc.saveAudio({
      buffer: Buffer.from('RAWAUDIO'),
      mimetype,
      originalname,
    });

    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.url).toMatch(/\.mp3$/);
    expect(storage.put).toHaveBeenCalledWith(
      expect.stringMatching(/^audio\/.+\.mp3$/),
      expect.any(Buffer),
      'audio/mpeg',
    );
  });

  it('grava o temp com a extensão do arquivo original — ffmpeg precisa dela para identificar o container', async () => {
    const { svc } = makeService();

    await svc.saveAudio({
      buffer: Buffer.from('RAWAUDIO'),
      mimetype: 'audio/x-m4a',
      originalname: 'memo.m4a',
    });

    expect(writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/\.m4a$/),
      expect.any(Buffer),
    );
  });

  it('continua recusando o que não é áudio', async () => {
    const { svc } = makeService();

    await expect(
      svc.saveAudio({
        buffer: Buffer.from('%PDF'),
        mimetype: 'application/pdf',
        originalname: 'contrato.pdf',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
