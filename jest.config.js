/** Tests des règles métier : environnement Node pur, SQLite réel (node:sqlite). */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'node16',
          moduleResolution: 'node16',
          target: 'es2022',
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
          isolatedModules: true,
          rootDir: '.',
          types: ['jest', 'node'],
        },
      },
    ],
  },
};
