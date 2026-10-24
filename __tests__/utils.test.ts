import { formatFCFA, formatSignedFCFA, parseAmount, assertValidAmount, MAX_AMOUNT } from '../src/utils/money';
import {
  addDays, addMonths, endOfMonth, endOfWeek, startOfWeek, isValidISODate, parseInputDate, toInputDate,
  formatDateFR, formatDateLongFR, formatMonthFR, eachDay, todayISO,
} from '../src/utils/dates';
import { ValidationError } from '../src/utils/errors';

describe('montants en FCFA', () => {
  test('formatage « 25 000 FCFA » (espace insécable)', () => {
    expect(formatFCFA(25000)).toBe('25\u00A0000\u00A0FCFA');
    expect(formatFCFA(0)).toBe('0\u00A0FCFA');
    expect(formatFCFA(1234567)).toBe('1\u00A0234\u00A0567\u00A0FCFA');
    expect(formatFCFA(-3000)).toBe('-3\u00A0000\u00A0FCFA');
    expect(formatSignedFCFA(500)).toBe('+500\u00A0FCFA');
  });

  test('parseAmount accepte les entiers (avec espaces) et rejette le reste', () => {
    expect(parseAmount('25000')).toBe(25000);
    expect(parseAmount('25 000')).toBe(25000);
    expect(parseAmount('25\u00A0000 FCFA')).toBe(25000);
    expect(parseAmount('0')).toBe(0);
    for (const bad of ['', 'abc', '12.5', '12,5', '-100', '1e3', '12 x', '0x10']) {
      expect(parseAmount(bad)).toBeNull();
    }
  });

  test('assertValidAmount : nuls, négatifs, décimaux, NaN, trop grands, non numériques', () => {
    expect(() => assertValidAmount(1)).not.toThrow();
    expect(() => assertValidAmount(MAX_AMOUNT)).not.toThrow();
    for (const bad of [0, -1, 12.5, NaN, Infinity, MAX_AMOUNT + 1, '100', null, undefined]) {
      expect(() => assertValidAmount(bad)).toThrow(ValidationError);
    }
  });
});

describe('dates', () => {
  test('validation stricte des dates AAAA-MM-JJ', () => {
    expect(isValidISODate('2026-02-28')).toBe(true);
    expect(isValidISODate('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', '24/10/2026', '', 'abc', 20261024]) {
      expect(isValidISODate(bad)).toBe(false);
    }
  });

  test('arithmétique de dates, semaines (lundi→dimanche) et mois', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(startOfWeek('2026-10-24')).toBe('2026-10-19'); // samedi → lundi
    expect(endOfWeek('2026-10-24')).toBe('2026-10-25');
    expect(startOfWeek('2026-10-19')).toBe('2026-10-19');
    expect(endOfMonth('2028-02')).toBe('2028-02-29');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(eachDay('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  test('formats français et saisie JJ/MM/AAAA', () => {
    expect(formatDateFR('2026-10-12')).toBe('12 oct. 2026');
    expect(formatDateLongFR('2026-10-24')).toBe('samedi 24 octobre 2026');
    expect(formatMonthFR('2026-02')).toBe('février 2026');
    expect(toInputDate('2026-10-05')).toBe('05/10/2026');
    expect(parseInputDate('5/10/2026')).toBe('2026-10-05');
    expect(parseInputDate('31/02/2026')).toBeNull();
    expect(parseInputDate('2026-10-05')).toBeNull();
  });

  test('todayISO utilise la date locale', () => {
    expect(todayISO(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

import { parseSignedAmount, formatCompact } from '../src/utils/money';

describe('saisies signées et formats compacts', () => {
  test('parseSignedAmount : soldes négatifs autorisés, décimaux refusés', () => {
    expect(parseSignedAmount('-5 000')).toBe(-5000);
    expect(parseSignedAmount('5000')).toBe(5000);
    expect(parseSignedAmount('-')).toBeNull();
    expect(parseSignedAmount('--5')).toBeNull();
    expect(parseSignedAmount('-5.5')).toBeNull();
    expect(parseSignedAmount('')).toBeNull();
  });
  test('formatCompact', () => {
    expect(formatCompact(0)).toBe('0');
    expect(formatCompact(950)).toBe('950');
    expect(formatCompact(25_000)).toBe('25 k');
    expect(formatCompact(1_250_000)).toBe('1,3 M');
    expect(formatCompact(-12_500)).toBe('-12,5 k');
  });
});
