import * as fs from 'fs';
import * as path from 'path';
import { renderPdfToPngs, MAX_RENDER_PAGES } from './pdf-render.util';
import { extractPdfText } from './pdf-text.util';

const FIXTURES = path.join(__dirname, '../../../test/fixtures');
// Voucher com camada de texto (gerado por Chromium).
const TEXT_PDF = path.join(FIXTURES, 'voucher-sample.pdf');
// Mesmo voucher rasterizado e re-embutido como JPEG num PDF de 4 páginas:
// imagem pura, ZERO camada de texto — é o caso do dono que motivou a feature.
const SCANNED_PDF = path.join(FIXTURES, 'voucher-scanned-4p.pdf');

/** PNG começa sempre com \x89PNG\r\n\x1a\n. */
function isPng(buf: Buffer): boolean {
  return buf.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
}

describe('renderPdfToPngs', () => {
  // Mesma razão do `pdf-text.util.spec`: a primeira chamada carrega o
  // `pdfjs-dist` (ESM) e o binding nativo do canvas, o que sob contenção de CPU
  // estoura o timeout padrão de 5s do Jest. Aquecer aqui tira o custo de carga
  // de dentro de um teste cronometrado.
  beforeAll(async () => {
    await renderPdfToPngs(fs.readFileSync(TEXT_PDF));
  }, 60000);

  it('rasteriza um PDF válido em PNGs não vazios', async () => {
    const out = await renderPdfToPngs(fs.readFileSync(TEXT_PDF));

    expect(out).toHaveLength(1);
    expect(isPng(out[0])).toBe(true);
    // Uma página em branco comprimiria para poucos KB; este piso prova que
    // sobrou tinta no canvas, não só o fundo branco.
    expect(out[0].length).toBeGreaterThan(10_000);
  });

  it('respeita o teto de páginas em vez de rasterizar o PDF inteiro', async () => {
    const buf = fs.readFileSync(SCANNED_PDF);

    const out = await renderPdfToPngs(buf);

    // A fixture tem 4 páginas de propósito: sem teto viriam 4.
    expect(MAX_RENDER_PAGES).toBe(3);
    expect(out).toHaveLength(3);
    expect(out.every(isPng)).toBe(true);
  }, 30000);

  it('aceita teto menor que o default', async () => {
    const out = await renderPdfToPngs(fs.readFileSync(SCANNED_PDF), 1);

    expect(out).toHaveLength(1);
  });

  it('rasteriza justamente o PDF que a camada de texto não consegue ler', async () => {
    // É este o encadeamento que a feature existe para cobrir: texto vazio
    // (escaneado) mas imagem legível. Se um dia a fixture ganhar camada de
    // texto, este teste avisa antes de o caminho de visão virar código morto.
    const buf = fs.readFileSync(SCANNED_PDF);

    expect(await extractPdfText(buf)).toBe('');
    expect((await renderPdfToPngs(buf)).length).toBeGreaterThan(0);
  }, 30000);

  it('devolve vazio em vez de estourar quando o buffer não é um PDF', async () => {
    await expect(
      renderPdfToPngs(Buffer.from('isso não é um pdf')),
    ).resolves.toEqual([]);
  });

  it('devolve vazio em vez de estourar com buffer vazio', async () => {
    await expect(renderPdfToPngs(Buffer.alloc(0))).resolves.toEqual([]);
  });
});
