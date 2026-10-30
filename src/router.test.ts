import { describe, expect, it } from 'vitest';
import { parseRoute, routeHref, ROUTES, tabOf } from './router';

describe('parseRoute', () => {
  it('riconosce ogni schermata', () => {
    expect(parseRoute('#/movimenti')).toBe('movimenti');
    expect(parseRoute('#/report')).toBe('report');
    expect(parseRoute('#/impostazioni')).toBe('impostazioni');
    expect(parseRoute('#/impostazioni/conti')).toBe('impostazioni/conti');
  });

  it('torna alla Home se il percorso è vuoto o sconosciuto', () => {
    expect(parseRoute('')).toBe('home');
    expect(parseRoute('#/')).toBe('home');
    expect(parseRoute('#/inesistente')).toBe('home');
    expect(parseRoute('#/impostazioni/inesistente')).toBe('home');
  });

  it('è coerente con routeHref', () => {
    for (const route of ROUTES) {
      expect(parseRoute(routeHref(route))).toBe(route);
    }
  });
});

describe('tabOf', () => {
  it('le sotto-schermate appartengono alla scheda da cui si aprono', () => {
    expect(tabOf('home')).toBe('home');
    expect(tabOf('impostazioni')).toBe('impostazioni');
    expect(tabOf('impostazioni/conti')).toBe('impostazioni');
  });
});
