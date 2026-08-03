import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  output: 'static',
  site: 'https://solar.tavaoneeducation.org',
  outDir: './dist',
  integrations: [
    sitemap({
      filter: page => !page.includes('/card/'),
    }),
  ],
});
