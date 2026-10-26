export type AccountType = 'cash' | 'mobile_money' | 'bank' | 'other';
export type TransactionType = 'income' | 'expense' | 'transfer';
export type CategoryKind = 'income' | 'expense';

export interface Account {
  id: number;
  name: string;
  type: AccountType;
  /** Code ISO 4217 de la devise du compte (XOF, EUR, USD…). */
  currency: string;
  /** Solde initial en plus petite unité de la devise du compte (entier, peut être négatif). */
  initialBalance: number;
  /** Date (AAAA-MM-JJ) à laquelle le solde initial correspond. */
  referenceDate: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AccountWithBalance extends Account {
  /** Solde courant, toujours calculé à partir des transactions. */
  balance: number;
}

export interface Category {
  id: number;
  name: string;
  kind: CategoryKind;
  active: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: number;
  type: TransactionType;
  /** Montant entier strictement positif, en plus petite unité de la devise du compte source. */
  amount: number;
  accountId: number;
  toAccountId: number | null;
  categoryId: number | null;
  description: string | null;
  /** Date effective AAAA-MM-JJ. */
  date: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionDetail extends Transaction {
  /** Devise du compte source (donc du montant). */
  currency: string;
  accountName: string;
  toAccountName: string | null;
  categoryName: string | null;
}

export interface Budget {
  id: number;
  categoryId: number;
  /** Mois AAAA-MM. */
  month: string;
  amount: number;
  createdAt: string;
  updatedAt: string;
}

/** Taux de change saisi à la main : 1 `fromCurrency` = rateScaled / 10^8 `toCurrency`, à partir de `effectiveDate`. */
export interface ExchangeRate {
  id: number;
  fromCurrency: string;
  toCurrency: string;
  rateScaled: number;
  effectiveDate: string;
  createdAt: string;
  updatedAt: string;
}

export type BudgetLevel = 'ok' | 'warning' | 'exceeded';

export interface BudgetStatus extends Budget {
  categoryName: string;
  spent: number;
  remaining: number;
  /** Pourcentage utilisé, arrondi à l'entier (peut dépasser 100). */
  percent: number;
  /** Dépenses de la catégorie exclues du « dépensé » faute de taux de change applicable. */
  excludedCount: number;
  level: BudgetLevel;
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: 'Espèces',
  mobile_money: 'Mobile Money',
  bank: 'Compte bancaire',
  other: 'Autre',
};

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  income: 'Entrée',
  expense: 'Dépense',
  transfer: 'Transfert',
};
