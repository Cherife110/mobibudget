/**
 * Schéma SQLite (version 1).
 * - Montants : INTEGER (FCFA), jamais de flottants.
 * - Dates métier : TEXT « AAAA-MM-JJ » ; horodatages techniques : TEXT ISO 8601.
 * - Aucun solde courant stocké : il est toujours calculé à partir des transactions.
 * - Aucun montant « dépensé » stocké dans budgets : calculé à partir des transactions.
 */
export const SCHEMA_V1: string[] = [
  `CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('cash', 'mobile_money', 'bank', 'other')),
    initial_balance INTEGER NOT NULL,
    reference_date TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (name, kind)
  )`,
  `CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
    to_account_id INTEGER REFERENCES accounts (id) ON DELETE RESTRICT,
    category_id INTEGER REFERENCES categories (id) ON DELETE RESTRICT,
    description TEXT,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (type = 'transfer' AND to_account_id IS NOT NULL AND to_account_id <> account_id AND category_id IS NULL)
      OR (type <> 'transfer' AND to_account_id IS NULL AND category_id IS NOT NULL)
    )
  )`,
  `CREATE TABLE budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
    month TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (category_id, month)
  )`,
  `CREATE INDEX idx_transactions_date ON transactions (date)`,
  `CREATE INDEX idx_transactions_account ON transactions (account_id, date)`,
  `CREATE INDEX idx_transactions_to_account ON transactions (to_account_id, date)`,
  `CREATE INDEX idx_transactions_category ON transactions (category_id, date)`,
  `CREATE INDEX idx_budgets_month ON budgets (month)`,
];
