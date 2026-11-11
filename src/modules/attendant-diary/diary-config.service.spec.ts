import { DiaryConfigService } from './diary-config.service';

const configWith = (value?: string) =>
  new DiaryConfigService({ get: () => value } as never);

describe('DiaryConfigService', () => {
  test('lista vazia desliga o diário', () => {
    const config = configWith('');

    expect(config.isEnabled).toBe(false);
    expect(config.participants).toEqual({ emails: [], domains: [] });
  });

  test('separa e-mails avulsos de domínios inteiros', () => {
    const config = configWith(' Barbara@OFP.com.br, @orlandofastpass.com.br ,');

    expect(config.participants).toEqual({
      emails: ['barbara@ofp.com.br'],
      domains: ['@orlandofastpass.com.br'],
    });
    expect(config.isEnabled).toBe(true);
  });

  test('só o domínio já liga o diário', () => {
    expect(configWith('@orlandofastpass.com.br').isEnabled).toBe(true);
  });
});
