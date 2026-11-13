import type { MysteryShopperSettings } from './mystery-shopper.types';

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);

const toStrings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((v) => (typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : ''))
        .filter((v) => v !== '')
    : [];

/** `organizations.settings.mysteryShopper`; ausente = ninguém vê e nada é enviado. */
export function readMysteryShopperSettings(settings: unknown): MysteryShopperSettings {
  const raw = isObject(settings) && isObject(settings.mysteryShopper) ? settings.mysteryShopper : {};
  return {
    viewerEmails: toStrings(raw.viewerEmails)
      .filter((v) => v.includes('@'))
      .map((v) => v.toLowerCase()),
    telegramChatIds: toStrings(raw.telegramChatIds),
  };
}

export function isViewer(settings: MysteryShopperSettings, email: string | null | undefined): boolean {
  return !!email && settings.viewerEmails.includes(email.trim().toLowerCase());
}
