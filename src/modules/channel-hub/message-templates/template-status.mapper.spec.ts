import { mapMetaTemplateStatus, normalizeRejectionReason } from './template-status.mapper';

describe('template-status.mapper', () => {
  it('mapeia eventos conhecidos da Meta para o enum interno', () => {
    expect(mapMetaTemplateStatus('APPROVED')).toBe('APPROVED');
    expect(mapMetaTemplateStatus('REJECTED')).toBe('REJECTED');
    expect(mapMetaTemplateStatus('PENDING')).toBe('PENDING');
    expect(mapMetaTemplateStatus('FLAGGED')).toBe('PAUSED');
    expect(mapMetaTemplateStatus('PAUSED')).toBe('PAUSED');
    expect(mapMetaTemplateStatus('PENDING_DELETION')).toBe('DISABLED');
    expect(mapMetaTemplateStatus('DISABLED')).toBe('DISABLED');
  });
  it('faz fallback seguro para PENDING em evento desconhecido', () => {
    expect(mapMetaTemplateStatus('SOMETHING_NEW')).toBe('PENDING');
    expect(mapMetaTemplateStatus(undefined as any)).toBe('PENDING');
  });
  it('normaliza motivo de rejeição', () => {
    expect(normalizeRejectionReason('NONE')).toBeUndefined();
    expect(normalizeRejectionReason(null)).toBeUndefined();
    expect(normalizeRejectionReason('')).toBeUndefined();
    expect(normalizeRejectionReason('ABUSIVE_CONTENT')).toBe('ABUSIVE_CONTENT');
  });
});
