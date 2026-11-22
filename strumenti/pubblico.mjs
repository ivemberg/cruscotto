// Dati pubblici, letti senza accessi: versioni e valutazioni iOS, classifica App Store,
// posizioni nelle ricerche Play. Gira ogni ora su GitHub Actions anche col Mac spento
// e scrive d/pubblico.json cifrato.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scriviCifrato } from './cifra.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
if (!JSON.parse(readFileSync(join(repo, 'chiavi.json'), 'utf8')).length) {
  console.log('Nessun dispositivo abbinato: niente da cifrare.');
  process.exit(0);
}
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', 'Accept-Language': 'it-IT' };

const app = [
  { app: 'Hai pagato?', apple: '6816096003', genere: '6003', categoria: 'Viaggi', play: 'com.ivemberg.haipagato' },
  { app: 'Recevia', apple: '6760703339', genere: '6000', categoria: 'Economia e aziende', play: 'com.ivemberg.recevia' },
  { app: 'Slottami', apple: '6804824586', genere: '6000', categoria: 'Economia e aziende', play: 'com.slottami.app' },
  { app: 'Tesserarius', apple: '6832230698', genere: '6024', categoria: 'Shopping', play: 'com.ivemberg.tesserarius' },
  { app: 'Lullabox', apple: '6824311897', genere: '6011', categoria: 'Musica' },
];
const parole = {
  'Hai pagato?': ['area c milano', 'pagamento area c', 'ztl milano', 'area b milano', 'pedaggi', 'pedemontana'],
  Recevia: ['nota spese', 'scanner scontrini', 'spese di viaggio', 'rimborso spese', 'recevia'],
  Slottami: ['gestione autoscuola', 'autoscuola', 'slottami'],
};

async function testo(url) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25000) });
    if (r.ok) return r.text();
    if (r.status !== 429) throw new Error(`${r.status} ${url}`);
    await new Promise((ok) => setTimeout(ok, 20000 * (i + 1)));
  }
  throw new Error(`429 ${url}`);
}

// Prime 200 gratis iPhone: 1-100 dal feed RSS, 101-200 dalla pagina Classifiche.
async function classifica(genere) {
  const feed = JSON.parse(await testo(`https://itunes.apple.com/it/rss/topfreeapplications/limit=100/genre=${genere}/json`));
  const rss = feed.feed.entry.map((x) => x.id.attributes['im:id']);
  const pagina = await testo(`https://apps.apple.com/it/iphone/charts/${genere}`);
  const re = /(\{"id":"\d+","type":"apps","href":"[^"]+"\}(?:,\{"id":"\d+","type":"apps","href":"[^"]+"\})*)/g;
  for (const m of pagina.matchAll(re)) {
    const ids = [...m[1].matchAll(/"id":"(\d+)"/g)].map((x) => x[1]);
    if (ids.length >= 75 && rss.slice(25, 100).join() === ids.slice(0, 75).join()) return rss.slice(0, 25).concat(ids);
  }
  return rss;
}

const errori = [];
const tenta = async (cosa, fn) => { try { return await fn(); } catch (e) { errori.push(`${cosa}: ${e.message}`); return null; } };
const oggi = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });

const ios = [];
const look = await tenta('iTunes lookup', async () => JSON.parse(await testo(`https://itunes.apple.com/lookup?id=${app.map((a) => a.apple).join(',')}&country=it`)).results);
for (const a of app) {
  const r = look?.find((x) => String(x.trackId) === a.apple);
  if (r) ios.push({ app: a.app, versione: r.version, valutazioni: r.userRatingCount ?? 0, media: r.averageUserRating ?? null, uscita: r.currentVersionReleaseDate });
}

const cl = [];
const cache = {};
for (const a of app) {
  cache[a.genere] ??= await tenta(`classifica ${a.categoria}`, () => classifica(a.genere));
  const c = cache[a.genere];
  if (c) cl.push({ data: oggi, app: a.app, categoria: a.categoria, posizione: c.includes(a.apple) ? c.indexOf(a.apple) + 1 : null, letti: c.length });
}

const pos = [];
for (const [nome, lista] of Object.entries(parole)) {
  const pkg = app.find((a) => a.app === nome).play;
  for (const p of lista) {
    const html = await tenta(`Play «${p}»`, () => testo(`https://play.google.com/store/search?q=${encodeURIComponent(p)}&c=apps&hl=it&gl=IT`));
    if (html == null) continue;
    const ids = [...new Set([...html.matchAll(/details\?id=([\w.]+)/g)].map((m) => m[1]))];
    pos.push({ data: oggi, app: nome, parola: p, posizione: ids.includes(pkg) ? ids.indexOf(pkg) + 1 : null });
  }
}

await scriviCifrato({ aggiornato: new Date().toISOString(), da: 'GitHub (ogni ora)', ios, classifica: cl, posizioni: pos, errori },
  join(repo, 'chiavi.json'), join(repo, 'd', 'pubblico.json'));
console.log(JSON.stringify({ ios: ios.length, classifica: cl.length, posizioni: pos.length, errori }));
