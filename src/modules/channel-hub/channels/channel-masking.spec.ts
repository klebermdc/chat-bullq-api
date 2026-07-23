import { OrgRole } from '@prisma/client';
import { maskChannelSecrets } from './channel-masking';

const channel = {
  id: 'ch1',
  name: 'WhatsApp Principal',
  type: 'WHATSAPP_OFFICIAL',
  config: { accessToken: 'EAABsecret', phoneNumberId: '123' },
  webhookSecret: 'hush',
  isActive: true,
};

describe('maskChannelSecrets', () => {
  it('OWNER mantém config e webhookSecret', () => {
    const result = maskChannelSecrets(channel, OrgRole.OWNER);
    expect(result).toEqual(channel);
    expect((result as any).config).toEqual(channel.config);
    expect((result as any).webhookSecret).toBe('hush');
  });

  it('ADMIN mantém config e webhookSecret', () => {
    const result = maskChannelSecrets(channel, OrgRole.ADMIN);
    expect((result as any).config).toEqual(channel.config);
    expect((result as any).webhookSecret).toBe('hush');
  });

  it('AGENT perde config e webhookSecret (chaves omitidas, não {}/null)', () => {
    const result = maskChannelSecrets(channel, OrgRole.AGENT);
    expect(result).not.toHaveProperty('config');
    expect(result).not.toHaveProperty('webhookSecret');
    // Resto dos campos permanece intacto — ícone/nome/tipo do canal no Inbox.
    expect(result).toMatchObject({
      id: 'ch1',
      name: 'WhatsApp Principal',
      type: 'WHATSAPP_OFFICIAL',
      isActive: true,
    });
  });

  it('role indefinido perde config e webhookSecret — fail-closed', () => {
    const result = maskChannelSecrets(channel, undefined);
    expect(result).not.toHaveProperty('config');
    expect(result).not.toHaveProperty('webhookSecret');
  });
});
