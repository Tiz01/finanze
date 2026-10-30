import { describe, expect, it } from 'vitest';
import {
  describeColumns,
  detectDateOrder,
  detectDecimal,
  distinctValues,
  extractRows,
  findHeaderRow,
  findProfile,
  guessIncomeValue,
  guessMapping,
  mappingProblem,
  mappingShapeProblem,
  parseStatementAmount,
  parseStatementDate,
  signatureOf,
} from './statementMapping';
import { parseDelimitedText } from './statementFile';
import type { ImportMapping, ImportProfile } from './types';

describe('parseStatementDate', () => {
  it.each([
    ['03/10/2026', '2026-10-03'],
    ['3/10/2026', '2026-10-03'],
    ['03-10-2026', '2026-10-03'],
    ['03.10.2026', '2026-10-03'],
    ['03/10/26', '2026-10-03'],
    ['03/10/2026 14:22', '2026-10-03'],
    ['2026-10-03', '2026-10-03'],
    ['2026-10-03 14:22:05', '2026-10-03'],
    ['2026-10-03T14:22:05Z', '2026-10-03'],
    ['2026/10/03', '2026-10-03'],
    ['20261003', '2026-10-03'],
    ['3 ott 2026', '2026-10-03'],
    ['03 ottobre 2026', '2026-10-03'],
    ['3-Oct-26', '2026-10-03'],
    ['1 gen 2026', '2026-01-01'],
    ['46298', '2026-10-03'],
    ['01/01/2026', '2026-01-01'],
    ['31/12/2026', '2026-12-31'],
    ['29/02/2028', '2028-02-29'],
  ])('legge %s', (text, expected) => {
    expect(parseStatementDate(text)).toBe(expected);
  });

  it.each(['', 'Saldo', '31/02/2026', '32/10/2026', '13/13/2026', '12345', '123456', '99 foo 2026', '2026-13-01'])(
    'rifiuta %s',
    (text) => {
      expect(parseStatementDate(text)).toBeNull();
    },
  );

  it('rispetta l’ordine scelto', () => {
    expect(parseStatementDate('03/04/2026', 'gma')).toBe('2026-04-03');
    expect(parseStatementDate('03/04/2026', 'mga')).toBe('2026-03-04');
    expect(parseStatementDate('10/30/2026', 'mga')).toBe('2026-10-30');
    expect(parseStatementDate('10/30/2026', 'gma')).toBeNull();
    expect(parseStatementDate('2026-03-04', 'mga')).toBe('2026-03-04');
  });

  it('il primo del mese resta il primo del mese, in qualunque fuso orario', () => {
    expect(parseStatementDate('01/10/2026')).toBe('2026-10-01');
  });
});

describe('detectDateOrder', () => {
  it('riconosce l’ordine da una data che non lascia dubbi', () => {
    expect(detectDateOrder(['03/04/2026', '25/04/2026'])).toBe('gma');
    expect(detectDateOrder(['03/04/2026', '04/25/2026'])).toBe('mga');
  });

  it('nel dubbio vale quello italiano', () => {
    expect(detectDateOrder(['03/04/2026'])).toBe('gma');
    expect(detectDateOrder([])).toBe('gma');
    expect(detectDateOrder(['2026-10-30'])).toBe('gma');
  });
});

describe('parseStatementAmount', () => {
  it.each([
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['-1.234,56', -123456],
    ['−1.234,56', -123456],
    ['+1.234,56', 123456],
    ['1.234', 123400],
    ['1.234.567,80', 123456780],
    ['12,5', 1250],
    ['0,05', 5],
    [',50', 50],
    ['-,50', -50],
    ['12', 1200],
    ['12,50-', -1250],
    ['12,50+', 1250],
    ['(12,50)', -1250],
    ['€ 12,50', 1250],
    ['-12,50 €', -1250],
    ['12,50 EUR', 1250],
    ['EUR -12,50', -1250],
    ['1 234,56', 123456],
    ['0,00', 0],
    ['-0,00', 0],
  ])('con la virgola decimale legge %s', (text, expected) => {
    expect(parseStatementAmount(text, ',')).toBe(expected);
  });

  it.each([
    ['1,234.56', 123456],
    ['1234.56', 123456],
    ['-12.50', -1250],
    ['12.5', 1250],
    ['1,234', 123400],
    ['1041.34', 104134],
  ])('con il punto decimale legge %s', (text, expected) => {
    expect(parseStatementAmount(text, '.')).toBe(expected);
  });

  it.each(['', 'abc', '12,345', '1.23,45', '12,50,00', '--5', '1.5', '€', '12a'])('con la virgola rifiuta %s', (text) => {
    expect(parseStatementAmount(text, ',')).toBeNull();
  });

  it('non accetta importi oltre il limite', () => {
    expect(parseStatementAmount('999.999.999.999,00')).toBeNull();
  });

  it('non usa i float: i centesimi sono esatti', () => {
    expect(parseStatementAmount('1041,34')).toBe(104134);
    expect(parseStatementAmount('19,99')).toBe(1999);
    expect(parseStatementAmount('0,07')).toBe(7);
    expect(parseStatementAmount('1,10')).toBe(110);
  });
});

describe('detectDecimal', () => {
  it('capisce il formato dalla colonna', () => {
    expect(detectDecimal(['1.234,56', '12,50'])).toBe(',');
    expect(detectDecimal(['1,234.56', '12.50'])).toBe('.');
    expect(detectDecimal(['1234.50', '12'])).toBe('.');
    expect(detectDecimal(['1.234', '12,50'])).toBe(',');
  });

  it('nel dubbio vale quello italiano', () => {
    expect(detectDecimal(['1.234', '5.000'])).toBe(',');
    expect(detectDecimal(['12'])).toBe(',');
    expect(detectDecimal([])).toBe(',');
  });
});

const CON_DUE_COLONNE = parseDelimitedText(`Estratto conto;;;;
Intestatario: Mario Prova;;;;
Periodo: dal 01/10/2026 al 31/10/2026;;;;
;;;;
Data contabile;Data valuta;Descrizione;Uscite;Entrate
03/10/2026;04/10/2026;PAGAMENTO POS SUPERMERCATO ROSSI;45,20;
05/10/2026;05/10/2026;BONIFICO STIPENDIO;;1.400,00
07/10/2026;07/10/2026;ADDEBITO SDD BOLLETTA;1.100,50;
Saldo finale;;;;2.254,30
`);

const CON_SEGNO = parseDelimitedText(`"Date","Description","Type","Amount","Balance"
"2026-10-03 10:12:00","SHOP, INC","CARD","-12.50","987.50"
"2026-10-05 09:00:00","Salary","TRANSFER","1,400.00","2,387.50"
`);

const CON_TIPO = parseDelimitedText(`Data;Causale;Importo;D/A
03/10/2026;Caffè;2,50;D
05/10/2026;Stipendio;1.400,00;A
`);

const SOLO_SPESE = parseDelimitedText(`Data operazione;Esercente;Importo
03/10/2026;RISTORANTE;25,00
04/10/2026;BENZINA;50,00
`);

const SENZA_INTESTAZIONE = parseDelimitedText(`03/10/2026;Caffè;-2,50
05/10/2026;Stipendio;1.400,00
`);

describe('findHeaderRow', () => {
  it('salta le righe introduttive', () => {
    expect(findHeaderRow(CON_DUE_COLONNE)).toBe(3);
  });

  it('trova le intestazioni in prima riga', () => {
    expect(findHeaderRow(CON_SEGNO)).toBe(0);
    expect(findHeaderRow(CON_TIPO)).toBe(0);
  });

  it('riconosce un file senza intestazioni', () => {
    expect(findHeaderRow(SENZA_INTESTAZIONE)).toBeNull();
  });

  it('non scambia per intestazione una riga con dei valori', () => {
    const rows = parseDelimitedText('Data estrazione;30/10/2026;Saldo contabile;1.234,56\nData;Valuta;Descrizione;Importo\n03/10/2026;03/10/2026;POS;-1,00\n');
    expect(findHeaderRow(rows)).toBe(1);
  });

  it('con nomi sconosciuti usa la riga prima dei dati', () => {
    expect(findHeaderRow([['Quando', 'Cosa', 'Quanto'], ['03/10/2026', 'POS', '-1,00']])).toBe(0);
  });
});

function mappingOf(rows: string[][]): ImportMapping {
  return guessMapping(rows, findHeaderRow(rows));
}

describe('guessMapping', () => {
  it('con entrate e uscite in due colonne', () => {
    const mapping = mappingOf(CON_DUE_COLONNE);
    expect(mapping.dateColumn).toBe(0);
    expect(mapping.descriptionColumn).toBe(2);
    expect(mapping.amount).toEqual({ mode: 'due-colonne', incomeColumn: 4, expenseColumn: 3 });
  });

  it('con una colonna con il segno, ignorando il saldo', () => {
    const mapping = mappingOf(CON_SEGNO);
    expect(mapping.dateColumn).toBe(0);
    expect(mapping.descriptionColumn).toBe(1);
    expect(mapping.amount).toEqual({ mode: 'segno', column: 3, invert: false });
  });

  it('con importo e colonna Dare/Avere', () => {
    expect(mappingOf(CON_TIPO).amount).toEqual({ mode: 'tipo', column: 2, typeColumn: 3, incomeValue: 'A' });
  });

  it('con importi tutti positivi e nessuna direzione li considera spese', () => {
    expect(mappingOf(SOLO_SPESE).amount).toEqual({ mode: 'segno', column: 2, invert: true });
  });

  it('senza intestazioni si basa sui valori', () => {
    const mapping = mappingOf(SENZA_INTESTAZIONE);
    expect(mapping.headerRow).toBeNull();
    expect(mapping.dateColumn).toBe(0);
    expect(mapping.descriptionColumn).toBe(1);
    expect(mapping.amount).toEqual({ mode: 'segno', column: 2, invert: false });
  });

  it('preferisce la data dell’operazione a quella di valuta', () => {
    const rows = parseDelimitedText('Data valuta;Data operazione;Descrizione;Importo\n04/10/2026;03/10/2026;POS;-1,00\n');
    expect(mappingOf(rows).dateColumn).toBe(1);
  });

  it('tra più descrizioni sceglie la più ricca', () => {
    const rows = parseDelimitedText('Data;Operazione;Dettagli;Importo\n03/10/2026;POS;Pagamento presso supermercato;-1,00\n');
    expect(mappingOf(rows).descriptionColumn).toBe(2);
  });

  it('non prende per importo una colonna di numeri senza decimali', () => {
    const rows = parseDelimitedText('Data;Numero;Descrizione;Importo\n03/10/2026;1001;POS;-1,00\n');
    expect(mappingOf(rows).amount).toEqual({ mode: 'segno', column: 3, invert: false });
  });

  it('capisce l’ordine americano delle date', () => {
    const rows = parseDelimitedText('Date;Description;Amount\n10/30/2026;Shop;-1.00\n');
    expect(mappingOf(rows).dateOrder).toBe('mga');
  });

  it('lascia vuoto quello che non trova', () => {
    const mapping = guessMapping([['Colonna'], ['boh']], 0);
    expect(mapping.dateColumn).toBeNull();
    expect(mapping.amount).toEqual({ mode: 'segno', column: null, invert: false });
    expect(mappingProblem(mapping)).toMatch(/data/);
  });
});

describe('mappingProblem', () => {
  const complete: ImportMapping = {
    headerRow: 0,
    dateColumn: 0,
    dateOrder: 'gma',
    descriptionColumn: 1,
    detailsColumn: null,
    amount: { mode: 'segno', column: 2, invert: false },
  };

  it('accetta una mappatura completa', () => {
    expect(mappingProblem(complete)).toBeNull();
  });

  it('dice cosa manca', () => {
    expect(mappingProblem({ ...complete, dateColumn: null })).toMatch(/data/);
    expect(mappingProblem({ ...complete, descriptionColumn: null })).toMatch(/descrizione/);
    expect(mappingProblem({ ...complete, amount: { mode: 'segno', column: null, invert: false } })).toMatch(/importo/);
    expect(mappingProblem({ ...complete, amount: { mode: 'due-colonne', incomeColumn: 2, expenseColumn: null } })).toMatch(/entrate e uscite/);
    expect(mappingProblem({ ...complete, amount: { mode: 'due-colonne', incomeColumn: 2, expenseColumn: 2 } })).toMatch(/diverse/);
    expect(mappingProblem({ ...complete, amount: { mode: 'tipo', column: 2, typeColumn: null, incomeValue: '' } })).toMatch(/tipo/);
    expect(mappingProblem({ ...complete, amount: { mode: 'tipo', column: 2, typeColumn: 3, incomeValue: '' } })).toMatch(/entrata/);
  });
});

describe('extractRows', () => {
  it('con due colonne dà il segno giusto e scarta la riga di saldo', () => {
    const { rows, skipped } = extractRows(CON_DUE_COLONNE, mappingOf(CON_DUE_COLONNE));
    expect(rows).toEqual([
      { date: '2026-10-03', description: 'PAGAMENTO POS SUPERMERCATO ROSSI', amountCents: -4520 },
      { date: '2026-10-05', description: 'BONIFICO STIPENDIO', amountCents: 140000 },
      { date: '2026-10-07', description: 'ADDEBITO SDD BOLLETTA', amountCents: -110050 },
    ]);
    expect(skipped).toEqual([{ text: 'Saldo finale · 2.254,30', reason: 'È una riga di saldo, non un movimento' }]);
  });

  it('con il formato inglese legge virgola e punto al contrario', () => {
    const { rows, skipped } = extractRows(CON_SEGNO, mappingOf(CON_SEGNO));
    expect(rows).toEqual([
      { date: '2026-10-03', description: 'SHOP, INC', amountCents: -1250 },
      { date: '2026-10-05', description: 'Salary', amountCents: 140000 },
    ]);
    expect(skipped).toEqual([]);
  });

  it('con Dare/Avere', () => {
    expect(extractRows(CON_TIPO, mappingOf(CON_TIPO)).rows).toEqual([
      { date: '2026-10-03', description: 'Caffè', amountCents: -250 },
      { date: '2026-10-05', description: 'Stipendio', amountCents: 140000 },
    ]);
  });

  it('inverte il segno quando serve', () => {
    expect(extractRows(SOLO_SPESE, mappingOf(SOLO_SPESE)).rows.map((row) => row.amountCents)).toEqual([-2500, -5000]);
  });

  it('senza intestazioni legge anche la prima riga', () => {
    expect(extractRows(SENZA_INTESTAZIONE, mappingOf(SENZA_INTESTAZIONE)).rows).toHaveLength(2);
  });

  it('aggiunge la seconda colonna alla descrizione', () => {
    const rows = parseDelimitedText('Data;Nome;Causale;Importo\n03/10/2026;Rossi;Affitto;-1,00\n');
    const mapping = { ...mappingOf(rows), descriptionColumn: 1, detailsColumn: 2 };
    expect(extractRows(rows, mapping).rows[0]?.description).toBe('Rossi · Affitto');
  });

  it('tiene da parte le righe che non può leggere, dicendo perché', () => {
    const rows = parseDelimitedText(`Data;Descrizione;Importo
ieri;Data strana;-1,00
03/10/2026;Importo strano;abc
04/10/2026;Senza importo;
;Senza data;-5,00
05/10/2026;Zero;0,00
06/10/2026;Buono;-3,00
`);
    const { rows: read, skipped } = extractRows(rows, mappingOf(rows));
    expect(read.map((row) => row.description)).toEqual(['Buono']);
    expect(skipped.map((row) => row.reason)).toEqual([
      'Data non leggibile',
      'Importo non leggibile',
      'Manca l’importo',
      'Manca la data',
      'Importo pari a zero',
    ]);
  });

  it('ignora in silenzio titoli e righe di chiusura', () => {
    const rows = parseDelimitedText('Data;Descrizione;Importo\n03/10/2026;Buono;-3,00\n;Fine del documento;\n');
    const { rows: read, skipped } = extractRows(rows, mappingOf(rows));
    expect(read).toHaveLength(1);
    expect(skipped).toEqual([]);
  });

  it('non scarta un pagamento che inizia con la parola saldo', () => {
    const rows = parseDelimitedText('Data;Descrizione;Importo\n03/10/2026;Saldo fattura 12;-30,00\n04/10/2026;Saldo al 30/09;100,00\n');
    const { rows: read, skipped } = extractRows(rows, mappingOf(rows));
    expect(read.map((row) => row.description)).toEqual(['Saldo fattura 12']);
    expect(skipped).toHaveLength(1);
  });

  it('con due colonne somma se sono piene entrambe, e segnala un valore illeggibile', () => {
    const rows = parseDelimitedText('Data;Descrizione;Uscite;Entrate\n03/10/2026;Entrambe;-10,00;25,00\n04/10/2026;Sbagliata;x;\n05/10/2026;Buona;-5,00;\n');
    const { rows: read, skipped } = extractRows(rows, mappingOf(rows));
    expect(read[0]?.amountCents).toBe(1500);
    expect(skipped[0]?.reason).toBe('Importo non leggibile');
  });

  it('il formato decimale si decide colonna per colonna', () => {
    const rows = parseDelimitedText('Data;Descrizione;Uscite;Entrate\n03/10/2026;A;1.000;\n04/10/2026;B;2,50;\n05/10/2026;C;;12.50\n');
    expect(extractRows(rows, mappingOf(rows)).rows.map((row) => row.amountCents)).toEqual([-100000, -250, 1250]);
  });
});

describe('riconoscere la banca', () => {
  const profile: ImportProfile = {
    id: 'p',
    name: 'Banca',
    signature: signatureOf(['Data contabile', 'Data valuta', 'Descrizione', 'Uscite', 'Entrate']),
    mapping: mappingOf(CON_DUE_COLONNE),
  };

  it('la firma ignora maiuscole, accenti e colonne vuote in fondo', () => {
    expect(signatureOf(['Dàta', 'IMPORTO', '', ''])).toBe('data|importo');
  });

  it('trova le intestazioni anche se cambiano le righe sopra', () => {
    expect(findProfile(CON_DUE_COLONNE, [profile])).toEqual({ profile, headerRow: 3 });
    expect(findProfile([['Una riga in più'], ...CON_DUE_COLONNE], [profile])?.headerRow).toBe(4);
  });

  it('non riconosce un altro file', () => {
    expect(findProfile(CON_SEGNO, [profile])).toBeNull();
    expect(findProfile(CON_DUE_COLONNE, [])).toBeNull();
  });

  it('una mappatura senza firma si sceglie solo a mano', () => {
    expect(findProfile(SENZA_INTESTAZIONE, [{ ...profile, signature: '' }])).toBeNull();
  });
});

describe('mappingShapeProblem', () => {
  const good = mappingOf(CON_DUE_COLONNE);

  it('accetta una mappatura vera', () => {
    expect(mappingShapeProblem(good)).toBeNull();
    expect(mappingShapeProblem(mappingOf(CON_SEGNO))).toBeNull();
    expect(mappingShapeProblem(mappingOf(CON_TIPO))).toBeNull();
  });

  it.each([
    [null],
    ['x'],
    [{}],
    [{ ...good, dateColumn: -1 }],
    [{ ...good, dateColumn: 'a' }],
    [{ ...good, dateOrder: 'x' }],
    [{ ...good, amount: null }],
    [{ ...good, amount: { mode: 'boh' } }],
    [{ ...good, amount: { mode: 'segno', column: 1 } }],
    [{ ...good, amount: { mode: 'tipo', column: 1, typeColumn: 2 } }],
  ])('rifiuta una mappatura rovinata', (mapping) => {
    expect(mappingShapeProblem(mapping)).not.toBeNull();
  });
});

describe('scelte della mappatura', () => {
  it('descrive le colonne con un esempio preso dal file', () => {
    expect(describeColumns(CON_TIPO, 0).map((column) => column.label)).toEqual([
      'Data (03/10/2026)',
      'Causale (Caffè)',
      'Importo (2,50)',
      'D/A (D)',
    ]);
  });

  it('senza intestazioni le numera', () => {
    expect(describeColumns(SENZA_INTESTAZIONE, null)[1]).toEqual({ value: '1', label: 'Colonna 2 (Caffè)' });
  });

  it('un esempio vuoto nella prima riga non nasconde quelli dopo', () => {
    expect(describeColumns(CON_DUE_COLONNE, 3)[4]?.label).toBe('Entrate (1.400,00)');
  });

  it('elenca i valori di una colonna una volta sola', () => {
    expect(distinctValues(CON_TIPO, 0, 3)).toEqual(['D', 'A']);
    expect(distinctValues(CON_TIPO, 0, null)).toEqual([]);
  });

  it('propone il valore che indica un’entrata, se lo riconosce', () => {
    expect(guessIncomeValue(['Dare', 'Avere'])).toBe('Avere');
    expect(guessIncomeValue(['-', '+'])).toBe('+');
    expect(guessIncomeValue(['X', 'Y'])).toBe('');
  });
});
