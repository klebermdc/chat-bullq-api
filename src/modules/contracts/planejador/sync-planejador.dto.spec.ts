import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SyncPlanejadorDto } from './sync-planejador.dto';

const errorsFor = (body: unknown) => validateSync(plainToInstance(SyncPlanejadorDto, body), { whitelist: true, forbidNonWhitelisted: true });

describe('SyncPlanejadorDto', () => {
  it.each([{}, { force: true }, { force: false }])('aceita %p', (body) => {
    expect(errorsFor(body)).toHaveLength(0);
  });

  it.each([{ force: 'true' }, { force: 1 }, { outra: true }])('recusa %p', (body) => {
    expect(errorsFor(body).length).toBeGreaterThan(0);
  });
});
