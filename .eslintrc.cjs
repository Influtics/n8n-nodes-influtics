module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  extends: ['plugin:n8n-nodes-base/all'],
  ignorePatterns: ['dist/**', 'node_modules/**'],
};
