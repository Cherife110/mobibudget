/** Tests des règles métier : environnement Node pur, SQLite réel (node:sqlite). */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      { isolatedModules: true, tsconfig: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', esModuleInterop: true, strict: true, skipLibCheck: true, types: ['jest', 'node'] } },
    ],
  },
};
