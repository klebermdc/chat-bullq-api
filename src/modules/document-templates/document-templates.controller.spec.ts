import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../common/decorators';
import { DocumentTemplatesController } from './document-templates.controller';
import { pdfFilename } from './pdf-response.util';
import { ConversationContractsController } from './conversation-contracts.controller';
import { AcceptancesController } from '../acceptances/acceptances.controller';

describe('DocumentTemplatesController — papéis', () => {
  const reflector = new Reflector();
  const roles = (method: keyof DocumentTemplatesController) =>
    reflector.get(ROLES_KEY, DocumentTemplatesController.prototype[method] as any);

  it('criar/editar/desativar só OWNER/ADMIN', () => {
    expect(roles('create')).toEqual(['OWNER', 'ADMIN']);
    expect(roles('update')).toEqual(['OWNER', 'ADMIN']);
    expect(roles('remove')).toEqual(['OWNER', 'ADMIN']);
  });

  it('leitura e preenchimento abertos a membros (regra fina no serviço)', () => {
    for (const m of ['list', 'get', 'autofill', 'render', 'pdf'] as const) {
      expect(roles(m)).toBeUndefined();
    }
  });
});

describe('pdfFilename', () => {
  it('gera nome ASCII a partir do título', () => {
    expect(pdfFilename('Contrato de Prestação — Viagem "Orlando"')).toBe('contrato-de-prestacao-viagem-orlando.pdf');
    expect(pdfFilename('')).toBe('documento.pdf');
  });
});

describe('limites por IP (throttler geral)', () => {
  const limit = (proto: any, method: string) => Reflect.getMetadata('THROTTLER:LIMITgeral', proto[method]);

  it('PDF do modelo e reenvios têm teto próprio', () => {
    expect(limit(DocumentTemplatesController.prototype, 'pdf')).toBe(30);
    expect(limit(ConversationContractsController.prototype, 'resend')).toBe(20);
    expect(limit(AcceptancesController.prototype, 'resend')).toBe(20);
  });
});
