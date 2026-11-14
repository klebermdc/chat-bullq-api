import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GeneratePersonaDto } from './generate-persona.dto';

async function errorsFor(brief: unknown) {
  const dto = plainToInstance(GeneratePersonaDto, { brief });
  return { dto, errors: await validate(dto) };
}

describe('GeneratePersonaDto', () => {
  it('aceita prévia curta e corta os espaços das pontas', async () => {
    const { dto, errors } = await errorsFor('  casal com 2 filhos, julho, Disney  ');
    expect(errors).toHaveLength(0);
    expect(dto.brief).toBe('casal com 2 filhos, julho, Disney');
  });

  it('recusa prévia com menos de 5 letras depois do trim', async () => {
    expect((await errorsFor('   abc   ')).errors).not.toHaveLength(0);
  });

  it('recusa prévia acima de 500 caracteres', async () => {
    expect((await errorsFor('a'.repeat(501))).errors).not.toHaveLength(0);
  });

  it('recusa o que não é texto', async () => {
    expect((await errorsFor(12345)).errors).not.toHaveLength(0);
    expect((await errorsFor(undefined)).errors).not.toHaveLength(0);
  });
});
