import { ValidationPipe } from '@nestjs/common';
import { UpsertSkillDto } from './upsert-skill.dto';

describe('UpsertSkillDto — sqlParamMap sob ValidationPipe (whitelist)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  const base = {
    name: 'buscarClientePorTelefone',
    description: 'Busca cliente por telefone no banco.',
    source: 'SQL' as const,
    parameters: { type: 'object', properties: {} },
    toolId: 'tool_sql_1',
    sqlQuery: 'SELECT 1 WHERE org = $1 AND phone = $2',
    sqlReadOnly: true,
  };

  it('preserva os {source} do sqlParamMap (não vira [[], []])', async () => {
    const input = {
      ...base,
      sqlParamMap: [
        { source: 'ctx.organizationId' },
        { source: 'input.telefone' },
      ],
    };
    const out: any = await pipe.transform(input, {
      type: 'body',
      metatype: UpsertSkillDto,
    });
    expect(out.sqlParamMap).toEqual([
      { source: 'ctx.organizationId' },
      { source: 'input.telefone' },
    ]);
    // O bug antigo devolvia [[], []] → params $1/$2 = NULL.
    expect(out.sqlParamMap[0].source).toBe('ctx.organizationId');
    expect(out.sqlParamMap[1].source).toBe('input.telefone');
  });
});
