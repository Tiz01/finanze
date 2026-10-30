import Papa from 'papaparse';

/** Un foglio del file, con ogni cella ridotta a testo e senza le righe vuote. */
export interface StatementSheet {
  name: string;
  rows: string[][];
}

const MAX_ROWS = 20_000;
const MAX_COLUMNS = 60;
const DELIMITERS = [';', '\t', ',', '|'];
const DELIMITER_SAMPLE_ROWS = 50;

/** Le banche italiane usano ancora spesso Windows-1252: si prova UTF-8 e si ripiega su quello. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function cleanCell(cell: string): string {
  const text = cell.replaceAll(' ', ' ').trim();
  // Alcune banche scrivono ="03/10/2026" per impedire a Excel di interpretare il valore.
  const wrapped = /^="(.*)"$/.exec(text);
  return (wrapped?.[1] ?? text).trim();
}

function splitRows(text: string, delimiter: string, preview = 0): string[][] {
  return Papa.parse<string[]>(text, { delimiter, preview, skipEmptyLines: 'greedy' }).data;
}

/** Il separatore che dà più righe con lo stesso numero di colonne, così le righe introduttive non confondono. */
function guessDelimiter(text: string): string {
  let best = DELIMITERS[0] ?? ';';
  let bestScore = 0;
  for (const delimiter of DELIMITERS) {
    const counts = new Map<number, number>();
    for (const { length } of splitRows(text, delimiter, DELIMITER_SAMPLE_ROWS)) {
      counts.set(length, (counts.get(length) ?? 0) + 1);
    }
    for (const [columns, rows] of counts) {
      const score = rows * (columns - 1);
      if (score > bestScore) {
        best = delimiter;
        bestScore = score;
      }
    }
  }
  return best;
}

export function parseDelimitedText(text: string): string[][] {
  return splitRows(text, guessDelimiter(text))
    .slice(0, MAX_ROWS)
    .map((row) => row.map(cleanCell))
    .filter((row) => row.some((cell) => cell !== ''));
}

type Spreadsheet = typeof import('xlsx');
type Cell = { t?: string; v?: unknown; z?: unknown };

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function cellText(XLSX: Spreadsheet, cell: Cell | undefined, date1904: boolean): string {
  if (!cell || cell.v === undefined || cell.v === null || cell.t === 'e' || cell.t === 'z') return '';
  if (cell.t === 'n' && typeof cell.v === 'number') {
    // Dal numero di serie alla data senza passare da Date: niente fusi orari, e nessun movimento cambia giorno.
    if (typeof cell.z === 'string' && XLSX.SSF.is_date(cell.z)) {
      const parts = XLSX.SSF.parse_date_code(cell.v, { date1904 }) as { y: number; m: number; d: number } | null;
      if (parts) return `${parts.y}-${pad(parts.m)}-${pad(parts.d)}`;
    }
    return Number.isInteger(cell.v) ? String(cell.v) : cell.v.toFixed(2);
  }
  return cleanCell(String(cell.v));
}

function sheetRows(XLSX: Spreadsheet, sheet: Record<string, unknown> | undefined, date1904: boolean): string[][] {
  const ref = sheet?.['!ref'];
  if (!sheet || typeof ref !== 'string') return [];
  const { s: start, e: end } = XLSX.utils.decode_range(ref);
  const lastRow = Math.min(end.r, start.r + MAX_ROWS - 1);
  const lastColumn = Math.min(end.c, start.c + MAX_COLUMNS - 1);
  const rows: string[][] = [];
  for (let r = start.r; r <= lastRow; r += 1) {
    const row: string[] = [];
    for (let c = start.c; c <= lastColumn; c += 1) {
      row.push(cellText(XLSX, sheet[XLSX.utils.encode_cell({ r, c })] as Cell | undefined, date1904));
    }
    if (row.some((cell) => cell !== '')) rows.push(row);
  }
  return rows;
}

async function readWorkbook(bytes: Uint8Array): Promise<StatementSheet[]> {
  // A parte perché è grande: si carica solo quando arriva un foglio Excel.
  const XLSX = await import('xlsx');
  // raw: nei file di testo camuffati da .xls la libreria leggerebbe le date come americane.
  const workbook = XLSX.read(bytes, { type: 'array', cellNF: true, cellText: false, raw: true, sheetRows: MAX_ROWS });
  const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904);
  return workbook.SheetNames.map((name) => ({ name, rows: sheetRows(XLSX, workbook.Sheets[name], date1904) })).filter(
    (sheet) => sheet.rows.length > 0,
  );
}

function isWorkbook(fileName: string, bytes: Uint8Array): boolean {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const legacy = bytes[0] === 0xd0 && bytes[1] === 0xcf;
  return zip || legacy || /\.(xlsx|xlsm|xlsb|xls|ods)$/i.test(fileName);
}

/** Lancia un errore se il file è un foglio di calcolo illeggibile, per esempio protetto da password. */
export async function readStatementFile(fileName: string, bytes: Uint8Array): Promise<StatementSheet[]> {
  if (isWorkbook(fileName, bytes)) return readWorkbook(bytes);
  const rows = parseDelimitedText(decodeText(bytes));
  return rows.length > 0 ? [{ name: fileName, rows }] : [];
}
