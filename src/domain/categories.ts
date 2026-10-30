import type { Category, CategoryKind } from './types';

// Identificatori stabili: i report riconoscono queste categorie anche se vengono rinominate.
export const CATEGORY_IDS = {
  stipendio: 'cat-stipendio',
  regaliRicevuti: 'cat-regali-ricevuti',
  rimborsi: 'cat-rimborsi',
  nonTracciato: 'cat-non-tracciato',
} as const;

export const CATEGORY_COLORS = [
  '#0f766e',
  '#0284c7',
  '#4f46e5',
  '#9333ea',
  '#db2777',
  '#dc2626',
  '#ea580c',
  '#ca8a04',
  '#65a30d',
  '#16a34a',
  '#64748b',
  '#92400e',
] as const;

const INCOME_GROUP = 'Entrate';
const ESSENTIAL_GROUP = 'Essenziali';
const LIFESTYLE_GROUP = 'Stile di vita';
const OTHER_GROUP = 'Altro';

function category(
  order: number,
  id: string,
  name: string,
  kind: CategoryKind,
  group: string,
  emoji: string,
  color: string,
  options: { fissa?: boolean; system?: boolean } = {},
): Category {
  return {
    id,
    name,
    kind,
    group,
    emoji,
    color,
    fissa: options.fissa ?? false,
    archived: false,
    system: options.system ?? false,
    order,
  };
}

export const DEFAULT_CATEGORIES: readonly Category[] = [
  category(1, CATEGORY_IDS.stipendio, 'Stipendio', 'entrata', INCOME_GROUP, '💼', '#0f766e', { system: true }),
  category(2, CATEGORY_IDS.regaliRicevuti, 'Regali e soldi ricevuti', 'entrata', INCOME_GROUP, '💝', '#db2777', {
    system: true,
  }),
  category(3, CATEGORY_IDS.rimborsi, 'Rimborsi', 'entrata', INCOME_GROUP, '↩️', '#0284c7', { system: true }),
  category(4, 'cat-borse', 'Borse di studio / altro reddito', 'entrata', INCOME_GROUP, '📚', '#4f46e5'),
  category(5, 'cat-straordinarie', 'Entrate straordinarie', 'entrata', INCOME_GROUP, '✨', '#ca8a04'),
  category(6, 'cat-casa', 'Casa e utenze', 'uscita', ESSENTIAL_GROUP, '🏠', '#92400e', { fissa: true }),
  category(7, 'cat-spesa', 'Spesa alimentare', 'uscita', ESSENTIAL_GROUP, '🛒', '#16a34a'),
  category(8, 'cat-ristoranti', 'Ristoranti, bar, uscite', 'uscita', LIFESTYLE_GROUP, '🍽️', '#ea580c'),
  category(9, 'cat-trasporti', 'Trasporti', 'uscita', ESSENTIAL_GROUP, '🚆', '#0284c7'),
  category(10, 'cat-viaggi', 'Viaggi', 'uscita', LIFESTYLE_GROUP, '✈️', '#4f46e5'),
  category(11, 'cat-sport-salute', 'Sport e salute', 'uscita', LIFESTYLE_GROUP, '🏃', '#65a30d'),
  category(12, 'cat-cura', 'Cura personale e profumi', 'uscita', LIFESTYLE_GROUP, '🧴', '#db2777'),
  category(13, 'cat-abbigliamento', 'Abbigliamento', 'uscita', LIFESTYLE_GROUP, '👕', '#9333ea'),
  category(14, 'cat-abbonamenti', 'Abbonamenti digitali', 'uscita', LIFESTYLE_GROUP, '📱', '#0f766e', {
    fissa: true,
  }),
  category(15, 'cat-universita', 'Università e formazione', 'uscita', ESSENTIAL_GROUP, '🎓', '#ca8a04'),
  category(16, 'cat-regali-fatti', 'Regali fatti', 'uscita', LIFESTYLE_GROUP, '🎁', '#dc2626'),
  category(17, 'cat-tecnologia', 'Tecnologia', 'uscita', LIFESTYLE_GROUP, '💻', '#64748b'),
  category(18, 'cat-commissioni', 'Commissioni e tasse', 'uscita', ESSENTIAL_GROUP, '🧾', '#64748b'),
  category(19, 'cat-altro', 'Altro', 'uscita', OTHER_GROUP, '📦', '#64748b'),
  category(20, CATEGORY_IDS.nonTracciato, 'Non tracciato', 'rettifica', OTHER_GROUP, '❓', '#64748b', {
    system: true,
  }),
];

/** Il primo carattere visibile del testo: un'emoji può occupare più punti di codice. */
export function firstGrapheme(text: string): string {
  const segments = new Intl.Segmenter('it', { granularity: 'grapheme' }).segment(text.trim());
  for (const { segment } of segments) return segment;
  return '';
}
