import { describe, expect, it } from 'vitest';
import { parseRoute, routeHref, ROUTES } from './router';

describe('parseRoute', () => {
  it('riconosce ogni schermata', () => {
    expect(parseRoute('#/movimenti')).toBe('movimenti');
    expect(parseRoute('#/report')).toBe('report');
    expect(parseRoute('#/impostazioni')).toBe('impostazioni');
  });

  it('torna alla Home se il percorso è vuoto o sconosciuto', () => {
    expect(parseRoute('')).toBe('home');
    expect(parseRoute('#/')).toBe('home');
    expect(parseRoute('#/inesistente')).toBe('home');
  });

  it('è coerente con routeHref', () => {
    for (const route of ROUTES) {
      expect(parseRoute(routeHref(route))).toBe(route);
    }
  });
});
