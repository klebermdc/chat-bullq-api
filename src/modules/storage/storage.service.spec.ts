import { StorageService } from './storage.service';

function build() {
  const config = { get: (k: string) => undefined } as any;
  const service = new StorageService(config);
  // injeta um client MinIO falso
  const removeObject = jest.fn(async () => undefined);
  (service as any).client = { removeObject };
  (service as any).bucket = 'test-bucket';
  return { service, removeObject };
}

describe('StorageService.remove', () => {
  it('remove o objeto pela key no bucket configurado', async () => {
    const { service, removeObject } = build();
    await service.remove('library/2026-07-12/abc.jpg');
    expect(removeObject).toHaveBeenCalledWith('test-bucket', 'library/2026-07-12/abc.jpg');
  });

  it('não lança quando o objeto já não existe (NoSuchKey)', async () => {
    const { service } = build();
    (service as any).client.removeObject = jest.fn(async () => {
      throw { code: 'NoSuchKey' };
    });
    await expect(service.remove('library/x.jpg')).resolves.toBeUndefined();
  });
});
