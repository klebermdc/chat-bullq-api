import { ChannelType, OrgRole } from '@prisma/client';
import {
  applySellerSignature,
  canSendUnsigned,
  formatSignature,
} from './seller-signature';

describe('seller-signature', () => {
  describe('formatSignature', () => {
    it('uses WhatsApp bold on WhatsApp channels', () => {
      expect(formatSignature('Bárbara', ChannelType.WHATSAPP_OFFICIAL)).toBe('*Bárbara:*');
      expect(formatSignature('Bárbara', ChannelType.WHATSAPP_ZAPPFY)).toBe('*Bárbara:*');
    });

    it('uses plain text where asterisks would show literally', () => {
      expect(formatSignature('Bárbara', ChannelType.INSTAGRAM)).toBe('Bárbara:');
      expect(formatSignature('Bárbara', ChannelType.MESSENGER)).toBe('Bárbara:');
    });

    it('trims the name', () => {
      expect(formatSignature('  Pedro  ', ChannelType.WHATSAPP_OFFICIAL)).toBe('*Pedro:*');
    });
  });

  describe('applySellerSignature', () => {
    const base = {
      type: 'TEXT',
      senderName: 'Bárbara',
      channelType: ChannelType.WHATSAPP_OFFICIAL,
    };

    it('puts the signature on the line above the text', () => {
      const content = { text: 'Oi, tudo bem?' };
      expect(applySellerSignature(content, base)).toEqual({
        text: '*Bárbara:*\nOi, tudo bem?',
      });
    });

    it('does not mutate the original content', () => {
      const content = { text: 'Oi' };
      applySellerSignature(content, base);
      expect(content).toEqual({ text: 'Oi' });
    });

    it('keeps other content fields', () => {
      const content = { text: 'Oi', previewUrl: true };
      expect(applySellerSignature(content, base)).toEqual({
        text: '*Bárbara:*\nOi',
        previewUrl: true,
      });
    });

    it('leaves non-text messages untouched', () => {
      const content = { mediaUrl: 'https://x/y.jpg', caption: 'foto' };
      expect(applySellerSignature(content, { ...base, type: 'IMAGE' })).toBe(content);
    });

    it('leaves empty text untouched', () => {
      const content = { text: '   ' };
      expect(applySellerSignature(content, base)).toBe(content);
    });

    it('leaves content untouched when the sender has no name', () => {
      const content = { text: 'Oi' };
      expect(applySellerSignature(content, { ...base, senderName: '  ' })).toBe(content);
      expect(applySellerSignature(content, { ...base, senderName: null })).toBe(content);
    });
  });

  describe('canSendUnsigned', () => {
    it('allows owners and admins', () => {
      expect(canSendUnsigned(OrgRole.OWNER)).toBe(true);
      expect(canSendUnsigned(OrgRole.ADMIN)).toBe(true);
    });

    it('denies agents and unknown roles', () => {
      expect(canSendUnsigned(OrgRole.AGENT)).toBe(false);
      expect(canSendUnsigned(undefined)).toBe(false);
    });
  });
});
