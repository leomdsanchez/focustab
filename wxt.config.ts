import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    envPrefix: ['VITE_', 'WXT_', 'PEXELS_'],
  }),
  manifest: {
    name: 'FocusTab',
    description: 'Personal new tab page focused on local productivity.',
    permissions: ['storage'],
    chrome_url_overrides: {
      newtab: 'newtab/index.html',
    },
  },
});
