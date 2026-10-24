/**
 * Les dates métier sont des chaînes « AAAA-MM-JJ » en heure locale : aucun décalage de fuseau
 * possible, tri lexicographique = tri chronologique.
 */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function toISODate(d: Date): string {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(now: Date = new Date()): string {
  return toISODate(now);
}

export function isValidISODate(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2200) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function isValidMonth(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = MONTH_RE.exec(s);
  if (!m) return false;
  const mo = Number(m[2]);
  const y = Number(m[1]);
  return mo >= 1 && mo <= 12 && y >= 1900 && y <= 2200;
}

function utc(iso: string): Date {
  const m = ISO_RE.exec(iso)!;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function fromUtc(d: Date): string {
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(iso: string, n: number): string {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000);
}

/** Liste de tous les jours de `from` à `to` inclus. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const n = daysBetween(from, to);
  for (let i = 0; i <= n; i++) out.push(addDays(from, i));
  return out;
}

/** 0 = lundi … 6 = dimanche. */
function weekdayMon0(iso: string): number {
  return (utc(iso).getUTCDay() + 6) % 7;
}

export function startOfWeek(iso: string): string {
  return addDays(iso, -weekdayMon0(iso));
}

export function endOfWeek(iso: string): string {
  return addDays(startOfWeek(iso), 6);
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const m = MONTH_RE.exec(month)!;
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  return `${pad(Math.floor(total / 12), 4)}-${pad((total % 12) + 1)}`;
}

export function startOfMonth(month: string): string {
  return `${month}-01`;
}

export function endOfMonth(month: string): string {
  const m = MONTH_RE.exec(month)!;
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return `${month}-${pad(last)}`;
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** « octobre 2026 » */
export function formatMonthFR(month: string): string {
  const m = MONTH_RE.exec(month)!;
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** « 12 oct. 2026 » */
export function formatDateFR(iso: string): string {
  const m = ISO_RE.exec(iso)!;
  return `${Number(m[3])} ${MONTHS_SHORT[Number(m[2]) - 1]} ${m[1]}`;
}

/** « lundi 12 octobre 2026 » */
export function formatDateLongFR(iso: string): string {
  const m = ISO_RE.exec(iso)!;
  const wd = WEEKDAYS[utc(iso).getUTCDay()];
  return `${wd} ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** « 12 oct. » (axes de graphiques) */
export function formatDayMonthShort(iso: string): string {
  const m = ISO_RE.exec(iso)!;
  return `${Number(m[3])} ${MONTHS_SHORT[Number(m[2]) - 1]}`;
}

/** AAAA-MM-JJ -> JJ/MM/AAAA */
export function toInputDate(iso: string): string {
  const m = ISO_RE.exec(iso)!;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** JJ/MM/AAAA (ou J/M/AAAA) -> AAAA-MM-JJ, ou null si invalide. */
export function parseInputDate(text: string): string | null {
  const m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(text.trim());
  if (!m) return null;
  const iso = `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  return isValidISODate(iso) ? iso : null;
}

/** Horodatage technique (création / modification). */
export function nowISO(now: Date = new Date()): string {
  return now.toISOString();
}
