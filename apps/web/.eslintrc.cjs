module.exports = {
  root: true,
  extends: [
    '../../.eslintrc.json',
    'plugin:react-hooks/recommended',
  ],
  plugins: ['react-refresh'],
  env: { browser: true, es2022: true },
  settings: { react: { version: '18.3' } },
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
  },
};
