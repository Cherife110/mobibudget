import type { Db } from '../db/types';
import type { ExchangeRate } from '../types';

interface RateRow {
  id: number;
  from_currency: string;
  to_currency: string;
  rate_scaled: number;
  effective_date: string;
  created_at: string;
  updated_at: string;
}

export function mapRate(r: RateRow): ExchangeRate {
  return {
    id: r.id,
    fromCurrency: r.from_currency,
    toCurrency: r.to_currency,
    rateScaled: r.rate_scaled,
    effectiveDate: r.effective_date,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Du plus récent au plus ancien. */
export async function listRates(db: Db): Promise<ExchangeRate[]> {
  const rows = await db.all<RateRow>('SELECT * FROM exchange_rates ORDER BY effective_date DESC, id DESC');
  return rows.map(mapRate);
}

export async function getRate(db: Db, id: number): Promise<ExchangeRate | null> {
  const row = await db.first<RateRow>('SELECT * FROM exchange_rates WHERE id = ?', [id]);
  return row ? mapRate(row) : null;
}

/** Crée le taux, ou met à jour celui qui a déjà la même paire et la même date d'effet. */
export async function upsertRate(
  db: Db,
  r: { fromCurrency: string; toCurrency: string; rateScaled: number; effectiveDate: string },
  now: string,
): Promise<number> {
  await db.run(
    `INSERT INTO exchange_rates (from_currency, to_currency, rate_scaled, effective_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(from_currency, to_currency, effective_date)
     DO UPDATE SET rate_scaled = excluded.rate_scaled, updated_at = excluded.updated_at`,
    [r.fromCurrency, r.toCurrency, r.rateScaled, r.effectiveDate, now, now],
  );
  const row = await db.first<{ id: number }>(
    'SELECT id FROM exchange_rates WHERE from_currency = ? AND to_currency = ? AND effective_date = ?',
    [r.fromCurrency, r.toCurrency, r.effectiveDate],
  );
  return row!.id;
}

export async function deleteRateRow(db: Db, id: number): Promise<number> {
  const r = await db.run('DELETE FROM exchange_rates WHERE id = ?', [id]);
  return r.changes;
}
