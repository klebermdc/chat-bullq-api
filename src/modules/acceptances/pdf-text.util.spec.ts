import * as fs from 'fs';
import * as path from 'path';
import { extractPdfText, MIN_USEFUL_CHARS } from './pdf-text.util';

const FIXTURE = path.join(__dirname, '../../../test/fixtures/voucher-sample.pdf');

describe('extractPdfText', () => {
  // A PRIMEIRA chamada carrega o `pdfjs-dist` (ESM, via import dinâmico); as
  // seguintes custam ~5ms porque o loader do Node já cacheia o módulo. Esse
  // carregamento medido: ~520ms na máquina ociosa, 4-6s sob contenção pesada
  // de CPU — contra o timeout padrão de 5s do Jest, que é o que fazia este
  // arquivo falhar de forma intermitente (~2 em 11 rodadas da suíte cheia).
  //
  // Aquecer aqui tira o custo de carga de dentro de um teste cronometrado: é
  // setup, não é o que está sob teste. O timeout generoso vale só para o
  // aquecimento e é dimensionado pelo pior caso observado.
  beforeAll(async () => {
    await extractPdfText(fs.readFileSync(FIXTURE));
  }, 30000);

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
