/** Erreur de validation métier : son message est destiné à l'utilisateur (en français). */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof ValidationError) return e.message;
  if (e instanceof Error && e.name === 'BackupError') return e.message;
  return "Une erreur inattendue s'est produite. Vos données n'ont pas été modifiées.";
}
