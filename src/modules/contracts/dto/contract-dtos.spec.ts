import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateContractDto, MoveDateDto, UpdateContractDto } from './contract.dto';
import { GuideQueryDto } from './list-contracts.dto';
import { UpdateContractSettingsDto } from './settings.dto';

/** Mesmas opções do main.ts. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const body = (metatype: new () => object, value: unknown) => pipe.transform(value, { type: 'body', metatype });
const query = (metatype: new () => object, value: unknown) => pipe.transform(value, { type: 'query', metatype });

const CREATE = {
  fullName: 'Cliente Teste',
  cpf: '000.000.000-00',
  address: 'Rua Teste, 123',
  cep: '00000-000',
  email: 'c@example.com',
  phone: '(11) 90000-0000',
  guideName: 'Kleber',
  people: 2,
  amount: '2190,00',
  disneyGuest: false,
  parkDates: [{ parkId: 'epcot', date: '2026-12-02' }],
};

describe('UpdateContractDto', () => {
  it.each(['fullName', 'cpf', 'email', 'guideName', 'people', 'amount', 'disneyGuest', 'datesToBeDefined', 'parkDates'])(
    '%s: null dá 400',
    async (field) => {
      await expect(body(UpdateContractDto, { [field]: null })).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('campo ausente passa', async () => {
    await expect(body(UpdateContractDto, {})).resolves.toEqual({});
  });

  it.each(['sellerName', 'paymentMethod', 'pixKey', 'notes', 'legacyChatUrl'])('%s aceita null (limpa)', async (field) => {
    await expect(body(UpdateContractDto, { [field]: null })).resolves.toEqual({ [field]: null });
  });

  it('legacyChatUrl só https com protocolo', async () => {
    await expect(body(UpdateContractDto, { legacyChatUrl: 'http://app.umbler.com/x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(body(UpdateContractDto, { legacyChatUrl: 'app.umbler.com/x' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(body(UpdateContractDto, { legacyChatUrl: 'javascript:alert(1)' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(body(UpdateContractDto, { legacyChatUrl: 'https://app.umbler.com/x' })).resolves.toEqual({
      legacyChatUrl: 'https://app.umbler.com/x',
    });
  });

  it('amount acima de 20 caracteres dá 400', async () => {
    await expect(body(UpdateContractDto, { amount: '1.111.111.111.111.111,00' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('CreateContractDto', () => {
  it('datesToBeDefined é opcional', async () => {
    await expect(body(CreateContractDto, CREATE)).resolves.toMatchObject({ fullName: 'Cliente Teste' });
  });

  it('legacyChatUrl http dá 400 e amount longo dá 400', async () => {
    await expect(body(CreateContractDto, { ...CREATE, legacyChatUrl: 'http://x.com' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(body(CreateContractDto, { ...CREATE, amount: '1.111.111.111.111.111,00' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('UpdateContractSettingsDto', () => {
  it.each(['terms', 'pixKeys', 'guides', 'sellers'])('%s: null dá 400', async (field) => {
    await expect(body(UpdateContractSettingsDto, { [field]: null })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('campos anuláveis aceitam null', async () => {
    await expect(body(UpdateContractSettingsDto, { companyName: null, defaultPixKey: null })).resolves.toEqual({
      companyName: null,
      defaultPixKey: null,
    });
  });
});

describe('MoveDateDto', () => {
  it('parkId opcional, mas precisa ser um parque conhecido', async () => {
    const base = { from: '2026-12-02', to: '2026-12-03' };
    await expect(body(MoveDateDto, base)).resolves.toEqual(base);
    await expect(body(MoveDateDto, { ...base, parkId: 'epcot' })).resolves.toEqual({ ...base, parkId: 'epcot' });
    await expect(body(MoveDateDto, { ...base, parkId: 'nada' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('GuideQueryDto', () => {
  it('aceita guia único e ausente', async () => {
    await expect(query(GuideQueryDto, { guide: 'Kleber' })).resolves.toEqual({ guide: 'Kleber' });
    await expect(query(GuideQueryDto, {})).resolves.toEqual({});
  });

  it('?guide=a&guide=b dá 400 (não 500)', async () => {
    await expect(query(GuideQueryDto, { guide: ['a', 'b'] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('guia acima de 100 caracteres dá 400', async () => {
    await expect(query(GuideQueryDto, { guide: 'x'.repeat(101) })).rejects.toBeInstanceOf(BadRequestException);
  });
});
