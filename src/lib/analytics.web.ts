/** Navigateur (tests sur PC) : pas de Firebase, donc aucune statistique. Même interface que analytics.ts. */
export async function setAnalyticsEnabled(_enabled: boolean): Promise<void> {}

export function trackEvent(_name: string): void {}
