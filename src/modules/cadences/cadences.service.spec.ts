import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { CadenceTrigger } from '@prisma/client';
import { CadencesService } from './cadences.service';
import { CADENCE_DEFAULT_STEPS } from './cadences.constants';

/** Fake em memória do CadencesRepository (padrão ai-provider-keys.service.spec.ts). */
function makeFakeRepo() {
  const rows: any[] = [];
  let seq = 0;

  return {
    rows,
    findById: jest.fn(async (id: string) => rows.find((r) => r.id === id) ?? null),
    findByStage: jest.fn(
      async (orgId: string, stageId: string) =>
        rows.find(
          (r) => r.organizationId === orgId && r.stageId === stageId && r.enabled,
        ) ?? null,
    ),
    list: jest.fn(async (orgId: string) =>
      rows.filter((r) => r.organizationId === orgId),
    ),
    upsert: jest.fn(async (orgId: string, dto: any) => {
      let row: any;
      if (dto.id) {
        row = rows.find((r) => r.id === dto.id);
        Object.assign(row, dto);
      } else {
        row = { ...dto, id: `c${++seq}`, organizationId: orgId };
        rows.push(row);
      }
      row.steps = dto.steps;
      return row;
    }),
    remove: jest.fn(async (id: string) => {
      const idx = rows.findIndex((r) => r.id === id);
      const [removed] = rows.splice(idx, 1);
      return removed;
    }),
  };
}

function validDto(overrides: any = {}) {
  return {
    name: 'Cadência de negociação',
    trigger: CadenceTrigger.BOTH,
    enabled: true,
    allowManual: true,
    steps: [
      { order: 1, delayHours: 24, content: { text: 'A' }, options: ['SIM', 'NAO'] },
      { order: 2, delayHours: 72, content: { text: 'B' }, options: ['SIM', 'NAO'] },
    ],
    ...overrides,
  };
}

function build() {
  const repo = makeFakeRepo();
  const service = new CadencesService(repo as any);
  return { repo, service };
}

describe('CadencesService', () => {
  describe('upsert', () => {
    it('rejeita orders duplicados com BadRequestException', async () => {
      const { service } = build();
      const dto = validDto({
        steps: [
          { order: 1, delayHours: 24, content: { text: 'A' }, options: ['SIM'] },
          { order: 1, delayHours: 72, content: { text: 'B' }, options: ['SIM'] },
        ],
      });
      await expect(service.upsert('org1', dto as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejeita delayHours <= 0 com BadRequestException', async () => {
      const { service } = build();
      const dto = validDto({
        steps: [
          { order: 1, delayHours: 0, content: { text: 'A' }, options: ['SIM'] },
        ],
      });
      await expect(service.upsert('org1', dto as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejeita lista de steps vazia com BadRequestException', async () => {
      const { service } = build();
      const dto = validDto({ steps: [] });
      await expect(service.upsert('org1', dto as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('ordena os steps por order antes de salvar', async () => {
      const { service, repo } = build();
      const dto = validDto({
        steps: [
          { order: 3, delayHours: 120, content: { text: 'C' }, options: ['SIM'] },
          { order: 1, delayHours: 24, content: { text: 'A' }, options: ['SIM'] },
          { order: 2, delayHours: 72, content: { text: 'B' }, options: ['SIM'] },
        ],
      });
      const saved = await service.upsert('org1', dto as any);
      expect(saved!.steps.map((s: any) => s.order)).toEqual([1, 2, 3]);
      expect(repo.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('get', () => {
    it('retorna o template padrão (4 steps) quando não há cadência persistida', async () => {
      const { service } = build();
      const template = await service.get('org1');
      expect(template.id).toBeNull();
      expect(template.steps).toHaveLength(CADENCE_DEFAULT_STEPS.length);
      expect((template.steps[0].content as any).text).toBe(
        CADENCE_DEFAULT_STEPS[0].text,
      );
      expect(template.steps[0].delayHours).toBe(CADENCE_DEFAULT_STEPS[0].delayHours);
    });

    it('lança NotFoundException para id inexistente', async () => {
      const { service } = build();
      await expect(service.get('org1', 'nope')).rejects.toThrow(NotFoundException);
    });

    it('lança ForbiddenException quando o org não bate', async () => {
      const { service } = build();
      const created = await service.upsert('orgA', validDto() as any);
      await expect(service.get('orgB', created!.id)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('retorna a cadência persistida por id quando o org bate', async () => {
      const { service } = build();
      const created = await service.upsert('org1', validDto() as any);
      const found = await service.get('org1', created!.id);
      expect(found.id).toBe(created!.id);
    });
  });

  describe('list', () => {
    it('retorna as cadências persistidas do org', async () => {
      const { service } = build();
      await service.upsert('org1', validDto() as any);
      await service.upsert('org1', validDto({ name: 'Outra' }) as any);
      const all = await service.list('org1');
      expect(all).toHaveLength(2);
    });
  });

  describe('remove', () => {
    it('remove após checar o org; ForbiddenException se o org não bate', async () => {
      const { service } = build();
      const created = await service.upsert('orgA', validDto() as any);
      await expect(service.remove('orgB', created!.id)).rejects.toThrow(
        ForbiddenException,
      );
      await service.remove('orgA', created!.id);
      const all = await service.list('orgA');
      expect(all).toHaveLength(0);
    });
  });
});
