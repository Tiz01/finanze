import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { decodeText, parseDelimitedText, readStatementFile } from './statementFile';

const encoder = new TextEncoder();

function workbookBytes(sheets: Record<string, XLSX.WorkSheet>, bookType: XLSX.BookType = 'xlsx'): Uint8Array {
  const workbook = XLSX.utils.book_new();
  for (const [name, sheet] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook, sheet, name);
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType }) as ArrayBuffer);
}

// Il 3 ottobre 2026 come lo salva Excel: un numero di giorni, senza fuso orario.
const OTTOBRE_3 = 46298;

describe('decodeText', () => {
  it('toglie il BOM di UTF-8', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x44, 0x61]))).toBe('Da');
  });

  it('legge gli accenti di UTF-8', () => {
    expect(decodeText(encoder.encode('Caffè'))).toBe('Caffè');
  });

  it('ripiega su Windows-1252, ancora comune nelle banche italiane', () => {
    expect(decodeText(new Uint8Array([0x43, 0x61, 0x66, 0x66, 0xe8, 0x20, 0x80]))).toBe('Caffè €');
  });

  it('legge UTF-16', () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x44, 0x00, 0x61, 0x00]))).toBe('Da');
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x44, 0x00, 0x61]))).toBe('Da');
  });
});

describe('parseDelimitedText', () => {
  it('riconosce il punto e virgola anche con la virgola nei decimali', () => {
    expect(parseDelimitedText('Data;Descrizione;Importo\n03/10/2026;POS;-45,20\n')).toEqual([
      ['Data', 'Descrizione', 'Importo'],
      ['03/10/2026', 'POS', '-45,20'],
    ]);
  });

  it('non si confonde con le righe prima della tabella', () => {
    const rows = parseDelimitedText('Estratto conto, ottobre\nIntestatario: Rossi\n\nData;Descrizione;Importo\n03/10/2026;POS, Milano;-45,20\n05/10/2026;Bonifico;10,00\n');
    expect(rows.at(-1)).toEqual(['05/10/2026', 'Bonifico', '10,00']);
    expect(rows.at(-2)).toEqual(['03/10/2026', 'POS, Milano', '-45,20']);
  });

  it('rispetta le virgolette con la virgola come separatore', () => {
    expect(parseDelimitedText('"Date","Description","Amount"\n"2026-10-03","SHOP, INC","-12.50"\n').at(-1)).toEqual([
      '2026-10-03',
      'SHOP, INC',
      '-12.50',
    ]);
  });

  it('riconosce il tabulatore', () => {
    expect(parseDelimitedText('Data\tImporto\n03/10/2026\t-1,00\n').at(-1)).toEqual(['03/10/2026', '-1,00']);
  });

  it('salta le righe vuote, anche fatte di soli separatori', () => {
    expect(parseDelimitedText('a;b\n\n;;\n1;2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('toglie spazi e la protezione per Excel', () => {
    expect(parseDelimitedText('a;b\n="03/10/2026";  x \n').at(-1)).toEqual(['03/10/2026', 'x']);
  });
});

describe('readStatementFile', () => {
  it('legge un CSV', async () => {
    const [sheet] = await readStatementFile('conto.csv', encoder.encode('Data;Importo\n03/10/2026;-1,00\n'));
    expect(sheet?.rows).toEqual([
      ['Data', 'Importo'],
      ['03/10/2026', '-1,00'],
    ]);
  });

  it('non restituisce fogli per un file vuoto', async () => {
    expect(await readStatementFile('conto.csv', encoder.encode('\n\n'))).toEqual([]);
  });

  it('da un XLSX prende date senza fuso orario e importi senza errori di virgola', async () => {
    const sheet: XLSX.WorkSheet = {
      '!ref': 'A1:C3',
      A1: { t: 's', v: 'Data' },
      B1: { t: 's', v: 'Descrizione' },
      C1: { t: 's', v: 'Importo' },
      A2: { t: 'n', v: OTTOBRE_3, z: 'dd/mm/yyyy' },
      B2: { t: 's', v: ' Caffè ' },
      C2: { t: 'n', v: 1041.3400000000001, z: '#,##0.00' },
      A3: { t: 's', v: '05/10/2026' },
      B3: { t: 's', v: 'Stipendio' },
      C3: { t: 'n', v: -1400, z: 'General' },
    };
    const [read] = await readStatementFile('conto.xlsx', workbookBytes({ Movimenti: sheet }));
    expect(read?.name).toBe('Movimenti');
    expect(read?.rows).toEqual([
      ['Data', 'Descrizione', 'Importo'],
      ['2026-10-03', 'Caffè', '1041.34'],
      ['05/10/2026', 'Stipendio', '-1400'],
    ]);
  });

  it('tiene solo i fogli con qualcosa dentro', async () => {
    const bytes = workbookBytes({ Vuoto: { '!ref': 'A1:A1' }, Dati: { '!ref': 'A1:A1', A1: { t: 's', v: 'x' } } });
    expect((await readStatementFile('conto.xlsx', bytes)).map((sheet) => sheet.name)).toEqual(['Dati']);
  });

  it('riconosce un XLSX anche senza estensione', async () => {
    const bytes = workbookBytes({ Dati: { '!ref': 'A1:A1', A1: { t: 's', v: 'x' } } });
    expect((await readStatementFile('estratto', bytes))[0]?.rows).toEqual([['x']]);
  });

  it('legge il vecchio formato XLS', async () => {
    const sheet: XLSX.WorkSheet = {
      '!ref': 'A1:B1',
      A1: { t: 'n', v: OTTOBRE_3, z: 'dd/mm/yyyy' },
      B1: { t: 'n', v: -12.5, z: '0.00' },
    };
    const [read] = await readStatementFile('conto.xls', workbookBytes({ Dati: sheet }, 'biff8'));
    expect(read?.rows).toEqual([['2026-10-03', '-12.50']]);
  });

  it('in una tabella HTML camuffata da .xls non interpreta le date all’americana', async () => {
    const html = '<table><tr><td>Data</td><td>Importo</td></tr><tr><td>03/10/2026</td><td>-12,50</td></tr></table>';
    const [read] = await readStatementFile('conto.xls', encoder.encode(html));
    expect(read?.rows).toEqual([
      ['Data', 'Importo'],
      ['03/10/2026', '-12,50'],
    ]);
  });

  it('lancia un errore se il file Excel è rovinato', async () => {
    await expect(readStatementFile('conto.xlsx', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).rejects.toThrow();
  });
});
