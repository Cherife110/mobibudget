import {
  formatMoney, formatPlainAmount, parseMoneyInput, parseSignedMoneyInput, formatSignedMoney,
} from '../src/utils/money';
import { parseRate, formatRate, convertMinor, RateBook, RATE_MAX_SCALED, RATE_SCALE } from '../src/utils/fx';
import { CURRENCIES, getCurrency, isKnownCurrency } from '../src/constants/currencies';
import { ValidationError } from '../src/utils/errors';

const NB = '\u00A0';

describe('catalogue de devises ISO 4217', () => {
  test('codes uniques, 3 lettres majuscules, décimales plausibles', () => {
    const codes = CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of CURRENCIES) {
      expect(c.code).toMatch(/^[A-Z]{3}$/);
      expect([0, 2, 3]).toContain(c.exponent);
    }
    expect(getCurrency('XOF')).toMatchObject({ exponent: 0, symbol: 'FCFA' });
    expect(getCurrency('EUR').exponent).toBe(2);
    expect(getCurrency('USD').exponent).toBe(2);
    expect(getCurrency('JPY').exponent).toBe(0);
    expect(getCurrency('KWD').exponent).toBe(3);
    expect(isKnownCurrency('EUR')).toBe(true);
    expect(isKnownCurrency('eur')).toBe(false);
    expect(isKnownCurrency('ZZZ')).toBe(false);
    expect(() => getCurrency('ZZZ')).toThrow();
  });
});

describe('formatage et saisie par devise', () => {
  test('formatMoney : unités entières, centimes, millièmes, négatifs', () => {
    expect(formatMoney(25000, 'XOF')).toBe(`25${NB}000${NB}FCFA`);
    expect(formatMoney(1250, 'EUR')).toBe(`12,50${NB}€`);
    expect(formatMoney(5, 'EUR')).toBe(`0,05${NB}€`);
    expect(formatMoney(0, 'USD')).toBe(`0,00${NB}$`);
    expect(formatMoney(123456789, 'EUR')).toBe(`1${NB}234${NB}567,89${NB}€`);
    expect(formatMoney(-1250, 'EUR')).toBe(`-12,50${NB}€`);
    expect(formatMoney(1234, 'KWD')).toBe(`1,234${NB}KWD`);
    expect(formatMoney(1000, 'JPY')).toBe(`1${NB}000${NB}¥`);
    expect(formatMoney(-3000, 'XOF')).toBe(`-3${NB}000${NB}FCFA`);
    expect(formatSignedMoney(1250, 'EUR')).toBe(`+12,50${NB}€`);
    expect(formatPlainAmount(1250, 'EUR')).toBe('12,50');
    expect(formatPlainAmount(1234567, 'XOF')).toBe('1234567');
  });

  test('parseMoneyInput : exactement les décimales de la devise, sans flottant', () => {
    expect(parseMoneyInput('12,5', 'EUR')).toBe(1250);
    expect(parseMoneyInput('12.50', 'EUR')).toBe(1250);
    expect(parseMoneyInput('12', 'EUR')).toBe(1200);
    expect(parseMoneyInput('1 250,75', 'EUR')).toBe(125075);
    expect(parseMoneyInput('0,07', 'USD')).toBe(7);
    expect(parseMoneyInput('1,234', 'KWD')).toBe(1234);
    expect(parseMoneyInput('25 000', 'XOF')).toBe(25000);
    expect(parseMoneyInput('25 000 FCFA', 'XOF')).toBe(25000);
    expect(parseMoneyInput('0,1', 'EUR')! + parseMoneyInput('0,2', 'EUR')!).toBe(30);   // 0,1 + 0,2 = 0,30 exactement
    for (const [bad, cur] of [['12,505', 'EUR'], ['12,5', 'XOF'], ['', 'EUR'], ['-5', 'EUR'], ['abc', 'EUR'], ['1,2,3', 'EUR'], ['1e3', 'EUR'], ['1,2345', 'KWD']] as const) {
      expect(parseMoneyInput(bad, cur)).toBeNull();
    }
    expect(parseSignedMoneyInput('-12,50', 'EUR')).toBe(-1250);
    expect(parseSignedMoneyInput('-', 'EUR')).toBeNull();
    expect(parseSignedMoneyInput('--5', 'EUR')).toBeNull();
  });
});

describe('taux de change en entiers (8 décimales)', () => {
  test('parseRate / formatRate', () => {
    expect(parseRate('655,957')).toBe(65_595_700_000);
    expect(parseRate('655.957')).toBe(65_595_700_000);
    expect(parseRate('0,00152449')).toBe(152_449);
    expect(parseRate('1')).toBe(RATE_SCALE);
    expect(parseRate('10 000 000')).toBe(RATE_MAX_SCALED);
    for (const bad of ['', '0', '0,0', '-1', 'abc', '1,123456789', '10000001', '1,2,3']) expect(parseRate(bad)).toBeNull();
    expect(formatRate(65_595_700_000)).toBe('655,957');
    expect(formatRate(152_449)).toBe('0,00152449');
    expect(formatRate(RATE_SCALE)).toBe('1');
    expect(parseRate(formatRate(66_000_000_000))).toBe(66_000_000_000);
  });

  test('convertMinor : décimales propres à chaque devise, arrondi au plus proche', () => {
    const r = parseRate('655,957')!;
    expect(convertMinor(1000, 'EUR', 'XOF', r, false)).toBe(6560);        // 10,00 € = 6 559,57 → 6 560
    expect(convertMinor(1, 'EUR', 'XOF', r, false)).toBe(7);              // 0,01 € = 6,56 → 7
    expect(convertMinor(100, 'EUR', 'XOF', r, false)).toBe(656);
    expect(convertMinor(6560, 'XOF', 'EUR', r, true)).toBe(1000);         // sens inverse : on divise
    expect(convertMinor(656, 'XOF', 'EUR', r, true)).toBe(100);
    expect(convertMinor(-1000, 'EUR', 'XOF', r, false)).toBe(-6560);      // symétrique pour les négatifs
    expect(convertMinor(0, 'EUR', 'XOF', r, false)).toBe(0);
    expect(convertMinor(500, 'XOF', 'XOF', r, false)).toBe(500);          // même devise : identité
    expect(convertMinor(100, 'EUR', 'USD', parseRate('1,08')!, false)).toBe(108);   // 2 décimales → 2 décimales
    expect(convertMinor(10_000, 'KWD', 'XOF', parseRate('2000')!, false)).toBe(20_000);   // 3 décimales → 0
  });

  test('arrondi : la moitié s\'éloigne de zéro, de façon symétrique', () => {
    const half = parseRate('1,5')!;
    expect(convertMinor(1, 'JPY', 'XOF', half, false)).toBe(2);           // 1,5 → 2
    expect(convertMinor(-1, 'JPY', 'XOF', half, false)).toBe(-2);         // -1,5 → -2
    expect(convertMinor(3, 'JPY', 'XOF', half, false)).toBe(5);           // 4,5 → 5
    expect(convertMinor(1, 'JPY', 'XOF', parseRate('1,4999')!, false)).toBe(1);
  });

  test('grands montants exacts (BigInt) et dépassement signalé plutôt que silencieux', () => {
    const r = parseRate('655,957')!;
    expect(convertMinor(1_000_000_000_000, 'EUR', 'XOF', r, false)).toBe(6_559_570_000_000);
    expect(() => convertMinor(1_000_000_000_000, 'XOF', 'EUR', RATE_MAX_SCALED, false)).toThrow(ValidationError);
  });

  test('RateBook : taux en vigueur à la date, direct ou inverse, jamais de taux futur', () => {
    const book = new RateBook([
      { fromCurrency: 'EUR', toCurrency: 'XOF', rateScaled: parseRate('650')!, effectiveDate: '2026-09-01' },
      { fromCurrency: 'EUR', toCurrency: 'XOF', rateScaled: parseRate('660')!, effectiveDate: '2026-10-15' },
      { fromCurrency: 'XOF', toCurrency: 'USD', rateScaled: parseRate('0,0016')!, effectiveDate: '2026-10-01' },
    ]);
    expect(book.find('EUR', 'XOF', '2026-08-31')).toBeNull();                             // avant le 1er taux
    expect(book.convert(100, 'EUR', 'XOF', '2026-08-31')).toBeNull();
    expect(book.convert(100, 'EUR', 'XOF', '2026-09-01')).toBe(650);                       // jour d'effet inclus
    expect(book.convert(100, 'EUR', 'XOF', '2026-10-14')).toBe(650);
    expect(book.convert(100, 'EUR', 'XOF', '2026-10-15')).toBe(660);                       // nouveau taux, pas rétroactif
    expect(book.find('XOF', 'EUR', '2026-10-20')).toMatchObject({ inverse: true, rateScaled: parseRate('660')! });
    expect(book.convert(660, 'XOF', 'EUR', '2026-10-20')).toBe(100);                       // XOF→EUR via le taux EUR→XOF
    expect(book.convert(1000, 'XOF', 'USD', '2026-10-02')).toBe(160);                      // direct XOF→USD
    expect(book.convert(160, 'USD', 'XOF', '2026-10-02')).toBe(1000);                      // inverse
    expect(book.convert(1000, 'XOF', 'USD', '2026-09-30')).toBeNull();
    expect(book.convert(100, 'EUR', 'USD', '2026-10-20')).toBeNull();                      // pas de triangulation automatique
    expect(book.convert(0, 'EUR', 'USD', '2026-10-20')).toBe(0);                           // un montant nul n'a pas besoin de taux
    expect(book.convert(42, 'EUR', 'EUR', '2026-10-20')).toBe(42);
  });

  test('RateBook : si les deux sens existent, le plus récent l\'emporte', () => {
    const book = new RateBook([
      { fromCurrency: 'EUR', toCurrency: 'XOF', rateScaled: parseRate('650')!, effectiveDate: '2026-10-01' },
      { fromCurrency: 'XOF', toCurrency: 'EUR', rateScaled: parseRate('0,0015')!, effectiveDate: '2026-10-10' },
    ]);
    expect(book.find('EUR', 'XOF', '2026-10-05')).toMatchObject({ inverse: false });
    expect(book.find('EUR', 'XOF', '2026-10-12')).toMatchObject({ inverse: true });
  });
});
