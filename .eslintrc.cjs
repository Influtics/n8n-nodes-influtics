module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  // Use the narrower configs the plugin recommends for community packages.
  // The `all` config is marked `@TODO: Remove` upstream.
  extends: [
    'plugin:n8n-nodes-base/community',
    'plugin:n8n-nodes-base/credentials',
    'plugin:n8n-nodes-base/nodes',
  ],
  ignorePatterns: ['dist/**', 'node_modules/**'],
  // The rule below is documented as "Only applicable to nodes in the main
  // repository" but the plugin does not enforce that scope, so it fires on
  // community packages for arbitrary public documentationUrl values.
  // Community packages link to https://docs.influtics.com/ — a non-camelCase
  // URL is intentional, not a typo.
  rules: {
    'n8n-nodes-base/cred-class-field-documentation-url-miscased': 'off',
  },
};
