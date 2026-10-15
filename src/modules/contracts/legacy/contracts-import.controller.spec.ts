import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { ROLES_KEY } from '../../../common/decorators';
import { ContractsImportController } from './contracts-import.controller';
import { ImportContractsDto } from './dto/import-batch.dto';

describe('ContractsImportController', () => {
  const reflector = new Reflector();
  const service = { importFile: jest.fn() };
  const controller = new ContractsImportController(service as any);

  it('exige OrgRole.OWNER na classe (RolesGuard lê handler e classe)', () => {
    const roles = reflector.get<OrgRole[]>(ROLES_KEY, ContractsImportController);
    expect(roles).toEqual([OrgRole.OWNER]);
  });

  it.each(['contracts', 'blockedDates', 'settings', 'file', 'status'] as const)(
    'rota %s não afrouxa o papel exigido',
    (method) => {
      const handlerRoles = reflector.get<OrgRole[] | undefined>(
        ROLES_KEY,
        ContractsImportController.prototype[method],
      );
      expect(handlerRoles === undefined || handlerRoles.join() === OrgRole.OWNER).toBe(true);
    },
  );

  it('file() lança BadRequestException sem arquivo', () => {
    expect(() => controller.file('org-1', { path: 'a/b.png' }, undefined)).toThrow(
      BadRequestException,
    );
  });

  it('ValidationPipe global preserva os campos das linhas em rows', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    });
    const row = { id: 'x', client_name: 'Ana', total_value: '10.5', nested: { a: 1 } };
    const out = (await pipe.transform(
      { rows: [row] },
      { type: 'body', metatype: ImportContractsDto },
    )) as ImportContractsDto;
    expect(out.rows[0]).toEqual(row);
  });
});
