import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../docs/screenshots');
const BASE = 'http://localhost:5173';

const PAGES = [
  { url: '/dashboard',       file: 'dashboard.png',       waitFor: 2000 },
  { url: '/untersuchungen',  file: 'untersuchungen.png',  waitFor: 1500 },
  { url: '/ressourcen',      file: 'ressourcen.png',      waitFor: 1500 },
  { url: '/szenarien',       file: 'szenarien.png',       waitFor: 1500 },
  { url: '/diagramme',       file: 'diagramme.png',       waitFor: 2000 },
  { url: '/optimierung',     file: 'optimierung.png',     waitFor: 1500 },
];

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();

// Load the app once so localStorage is seeded
await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 2500));

for (const { url, file, waitFor } of PAGES) {
  console.log(`  → ${url}`);
  await page.goto(BASE + url, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, waitFor));
  await page.screenshot({ path: path.join(OUT, file), fullPage: false });
  console.log(`    saved: ${file}`);
}

// Extra: Untersuchungen with drag-and-drop layout visible (scroll a bit)
await page.goto(BASE + '/untersuchungen', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: path.join(OUT, 'untersuchungen-detail.png'), fullPage: true });

// Extra: Diagramme – sensitivity tab
await page.goto(BASE + '/diagramme', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: path.join(OUT, 'diagramme-sensitivitaet.png'), fullPage: false });

// Extra: Tagesplan tab on Diagramme
await page.evaluate(() => {
  const buttons = [...document.querySelectorAll('button')];
  const tp = buttons.find(b => b.textContent?.includes('Tagesplan'));
  if (tp) tp.click();
});
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: path.join(OUT, 'diagramme-tagesplan.png'), fullPage: false });

await browser.close();
console.log('\nDone! Screenshots saved to docs/screenshots/');
