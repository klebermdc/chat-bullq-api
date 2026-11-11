import { chunkMessage, escapeHtml, formatClock, formatDuration, formatPercent } from './manager-bot.format';

describe('escapeHtml', () => {
  it('escapa os caracteres que o Telegram exige', () => {
    expect(escapeHtml('A & B <b>')).toBe('A &amp; B &lt;b&gt;');
  });
});

describe('formatDuration', () => {
  it('usa minutos abaixo de 1h e h+min acima', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(125)).toBe('2h05');
    expect(formatDuration(60 * 30)).toBe('1d 6h');
  });
});

describe('formatClock', () => {
  it('mostra hora local', () => {
    expect(formatClock(new Date('2026-11-11T12:07:00Z'), 'America/Sao_Paulo')).toBe('09:07');
  });
});

describe('formatPercent', () => {
  it('mostra traço sem dado', () => {
    expect(formatPercent(null)).toBe('–');
    expect(formatPercent(91.6)).toBe('92%');
  });
});

describe('chunkMessage', () => {
  it('não quebra texto curto', () => {
    expect(chunkMessage('oi', 10)).toEqual(['oi']);
  });
  it('quebra nas linhas sem passar do limite', () => {
    expect(chunkMessage('aaaa\nbbbb\ncccc', 9)).toEqual(['aaaa\nbbbb', 'cccc']);
  });
  it('corta linha maior que o limite', () => {
    expect(chunkMessage('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });
});
