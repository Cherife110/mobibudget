/** Horloge injectable : permet de tester les règles dépendant de « aujourd'hui ». */
export interface Clock {
  now?: Date;
}
