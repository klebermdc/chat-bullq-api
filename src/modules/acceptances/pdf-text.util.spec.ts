import * as fs from 'fs';
import * as path from 'path';
import { extractPdfText, MIN_USEFUL_CHARS } from './pdf-text.util';

const FIXTURE = path.join(__dirname, '../../../test/fixtures/voucher-sample.pdf');

describe('extractPdfText', () => {
  it('lê a camada de texto de um voucher e devolve o conteúdo', async () => {
    const buf = fs.readFileSync(FIXTURE);

    const text = await extractPdfText(buf);

    expect(text).toContain('Magic Kingdom');
    expect(text).toContain('61293');
    expect(text).toContain('JTT-8842-XK');
  });

  it('devolve vazio quando o PDF tem menos texto útil que o piso', async () => {
    const buf = fs.readFileSync(FIXTURE);
    // Piso artificialmente alto simula o PDF escaneado (sem camada de texto).
    const text = await extractPdfText(buf, MIN_USEFUL_CHARS * 1000);

    expect(text).toBe('');
  });

  it('devolve vazio em vez de estourar quando o buffer não é um PDF', async () => {
    const text = await extractPdfText(Buffer.from('isso não é um pdf'));

    expect(text).toBe('');
  });
});
