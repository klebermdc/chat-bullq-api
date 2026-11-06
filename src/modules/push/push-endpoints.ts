/*
 * Adaptado de DeskcommCRM (https://github.com/melgarafael/DeskcommCRM), MIT License, Copyright (c) 2026 Rafael Melgaço.
 * Origem: lib/notifications/servicos-de-push.ts
 */

/**
 * Os serviços de push dos navegadores aceitos como destino de uma inscrição.
 * O servidor faz POST no `endpoint` gravado, então só entram hosts conhecidos,
 * por https, sem porta nem credencial na URL (evita SSRF).
 */
const EXACT_HOSTS: ReadonlySet<string> = new Set([
  'fcm.googleapis.com', // Chrome, Edge Android, Opera, Samsung Internet
  'updates.push.services.mozilla.com', // Firefox
]);

/** Subdomínio do serviço: o ponto inicial impede `evilpush.apple.com`. */
const HOST_SUFFIXES: readonly string[] = [
  '.push.apple.com', // Safari / iPhone (web.push.apple.com)
  '.notify.windows.com', // Edge no Windows (WNS)
];

export function isKnownPushService(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') {
    return false;
  }
  return EXACT_HOSTS.has(url.hostname) || HOST_SUFFIXES.some((s) => url.hostname.endsWith(s));
}
