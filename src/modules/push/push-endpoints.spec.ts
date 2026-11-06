import { isKnownPushService } from './push-endpoints';

describe('isKnownPushService', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGx',
    'https://wns2-by3p.notify.windows.com/w/?token=x',
  ])('aceita serviço conhecido: %s', (endpoint) => {
    expect(isKnownPushService(endpoint)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://user:pw@fcm.googleapis.com/x',
    'https://evilpush.apple.com/x',
    'https://push.apple.com.evil.com/x',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/x',
    'não é url',
    '',
  ])('recusa destino fora da lista: %s', (endpoint) => {
    expect(isKnownPushService(endpoint)).toBe(false);
  });
});
