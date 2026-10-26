/**
 * Catalogue de devises ISO 4217.
 * `exponent` = nombre de décimales de la plus petite unité : tous les montants sont stockés en
 * entiers de cette plus petite unité (XOF : 0 → francs ; EUR : 2 → centimes ; KWD : 3 → millièmes).
 */
export interface Currency {
  code: string;
  name: string;
  exponent: number;
  /** Libellé affiché après le montant (par défaut : le code). */
  symbol: string;
}

const c = (code: string, name: string, exponent: number, symbol: string = code): Currency => ({ code, name, exponent, symbol });

export const CURRENCIES: Currency[] = [
  c('XOF', 'Franc CFA (BCEAO)', 0, 'FCFA'),
  c('EUR', 'Euro', 2, '€'),
  c('USD', 'Dollar américain', 2, '$'),
  c('XAF', 'Franc CFA (BEAC)', 0),
  c('GBP', 'Livre sterling', 2, '£'),
  c('CHF', 'Franc suisse', 2),
  c('CAD', 'Dollar canadien', 2),
  c('AUD', 'Dollar australien', 2),
  c('NZD', 'Dollar néo-zélandais', 2),
  c('JPY', 'Yen japonais', 0, '¥'),
  c('CNY', 'Yuan renminbi', 2),
  c('KRW', 'Won sud-coréen', 0),
  c('INR', 'Roupie indienne', 2),
  c('AED', 'Dirham des Émirats', 2),
  c('SAR', 'Riyal saoudien', 2),
  c('TRY', 'Livre turque', 2),
  c('RUB', 'Rouble russe', 2),
  c('BRL', 'Réal brésilien', 2),
  c('MXN', 'Peso mexicain', 2),
  c('SEK', 'Couronne suédoise', 2),
  c('NOK', 'Couronne norvégienne', 2),
  c('DKK', 'Couronne danoise', 2),
  c('PLN', 'Zloty polonais', 2),
  c('ZAR', 'Rand sud-africain', 2),
  c('NGN', 'Naira nigérian', 2),
  c('GHS', 'Cedi ghanéen', 2),
  c('MAD', 'Dirham marocain', 2),
  c('DZD', 'Dinar algérien', 2),
  c('TND', 'Dinar tunisien', 3),
  c('LYD', 'Dinar libyen', 3),
  c('EGP', 'Livre égyptienne', 2),
  c('KES', 'Shilling kényan', 2),
  c('UGX', 'Shilling ougandais', 0),
  c('TZS', 'Shilling tanzanien', 2),
  c('ETB', 'Birr éthiopien', 2),
  c('RWF', 'Franc rwandais', 0),
  c('BIF', 'Franc burundais', 0),
  c('CDF', 'Franc congolais', 2),
  c('GNF', 'Franc guinéen', 0),
  c('KMF', 'Franc comorien', 0),
  c('DJF', 'Franc djiboutien', 0),
  c('XPF', 'Franc CFP', 0),
  c('MGA', 'Ariary malgache', 2),
  c('MUR', 'Roupie mauricienne', 2),
  c('GMD', 'Dalasi gambien', 2),
  c('SLE', 'Leone sierra-léonais', 2),
  c('LRD', 'Dollar libérien', 2),
  c('MRU', 'Ouguiya mauritanien', 2),
  c('HTG', 'Gourde haïtienne', 2),
  c('JOD', 'Dinar jordanien', 3),
  c('KWD', 'Dinar koweïtien', 3),
  c('BHD', 'Dinar bahreïni', 3),
  c('OMR', 'Rial omanais', 3),
  c('VND', 'Dong vietnamien', 0),
  c('IDR', 'Roupie indonésienne', 2),
  c('THB', 'Baht thaïlandais', 2),
  c('MYR', 'Ringgit malaisien', 2),
  c('SGD', 'Dollar de Singapour', 2),
  c('PHP', 'Peso philippin', 2),
  c('PKR', 'Roupie pakistanaise', 2),
  c('BDT', 'Taka bangladais', 2),
];

const BY_CODE = new Map(CURRENCIES.map((x) => [x.code, x]));

export const DEFAULT_REFERENCE_CURRENCY = 'XOF';
/** Devises proposées en premier dans les sélecteurs. */
export const COMMON_CURRENCIES = ['XOF', 'EUR', 'USD'];

export function isKnownCurrency(code: unknown): code is string {
  return typeof code === 'string' && BY_CODE.has(code);
}

export function getCurrency(code: string): Currency {
  const cur = BY_CODE.get(code);
  if (!cur) throw new Error(`Devise inconnue : ${code}`);
  return cur;
}
