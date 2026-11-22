// Dati privati dalle API ufficiali, con chiavi in sola lettura salvate nei segreti di GitHub:
// - App Store Connect (rapporti vendite): download iPhone e ricavi degli acquisti;
// - Google Play (rapporti nel bucket Cloud Storage): download Android e vendite stimate;
// - AdMob (rapporto rete): impressioni e guadagni stimati.
// Gira su GitHub Actions anche col Mac spento e scrive d/api.json cifrato.
// Il registro di un repository pubblico lo legge chiunque: qui si stampano solo conteggi
// e codici di errore, mai importi, righe o risposte delle API.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createSign, createPrivateKey } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scriviCifrato } from './cifra.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
if (!JSON.parse(readFileSync(join(repo, 'chiavi.json'), 'utf8')).length) {
  console.log('Nessun dispositivo abbinato: niente da cifrare.');
  process.exit(0);
}
const E = process.env;
const GIORNI = 35;

const APPLE = { '6816096003': 'Hai pagato?', '6760703339': 'Recevia', '6804824586': 'Slottami', '6832230698': 'Tesserarius', '6824311897': 'Lullabox' };
const PACCHETTI = { 'com.ivemberg.haipagato': 'Hai pagato?', 'com.ivemberg.recevia': 'Recevia', 'com.slottami.app': 'Slottami', 'com.ivemberg.tesserarius': 'Tesserarius' };
// Acquisti in-app: l'app si riconosce dall'ID prodotto.
const appDaProdotto = (id = '') =>
  id.startsWith('com.ivemberg.haipagato') ? 'Hai pagato?' :
  id.startsWith('com.ivemberg.tesserarius') ? 'Tesserarius' :
  id.startsWith('com.ivemberg.lullabox') || id.startsWith('com.ivemberg.carillon') ? 'Lullabox' :
  id.startsWith('com.ivemberg.recevia') ? 'Recevia' :
  id.startsWith('com.slottami') ? 'Slottami' : null;

const errori = [];
const fonti = {};
async function tenta(cosa, fn) {
  try { const r = await fn(); fonti[cosa] = 'ok'; return r; } catch (e) { errori.push(`${cosa}: ${e.message}`); fonti[cosa] = 'errore'; return null; }
}
async function chiama(url, opz, cosa) {
  const r = await fetch(url, { ...opz, signal: AbortSignal.timeout(60000) });
  if (!r.ok) { const err = new Error(`${cosa} ha risposto ${r.status}`); err.status = r.status; throw err; }
  return r;
}
const b64url = (x) => Buffer.from(x).toString('base64url');
const giornoIso = (d) => d.toISOString().slice(0, 10);
const ultimiGiorni = (n) => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1 - i); return giornoIso(d); });

// Cambi BCE del giorno verso l'euro, una volta per valuta e giorno.
const cambi = {};
async function inEuro(importo, valuta, giorno) {
  if (!importo || valuta === 'EUR') return importo;
  const k = `${giorno}|${valuta}`;
  if (!(k in cambi)) {
    const r = await chiama(`https://api.frankfurter.app/${giorno}?from=${valuta}&to=EUR`, {}, 'cambi');
    cambi[k] = (await r.json()).rates?.EUR ?? null;
  }
  if (cambi[k] == null) throw new Error(`cambio ${valuta} non disponibile`);
  return importo * cambi[k];
}
const tondo = (x) => Math.round(x * 100) / 100;

const guadagni = [], download = [], pubblicita = [];

// ---------- App Store Connect ----------
async function appStore() {
  const chiave = createPrivateKey(E.ASC_PRIVATE_KEY.replace(/\\n/g, '\n'));
  const ora = Math.floor(Date.now() / 1000);
  const testa = b64url(JSON.stringify({ alg: 'ES256', kid: E.ASC_KEY_ID, typ: 'JWT' }));
  const corpo = b64url(JSON.stringify({ iss: E.ASC_ISSUER_ID, iat: ora, exp: ora + 1200, aud: 'appstoreconnect-v1' }));
  const firma = createSign('SHA256').update(`${testa}.${corpo}`).sign({ key: chiave, dsaEncoding: 'ieee-p1363' });
  const jwt = `${testa}.${corpo}.${b64url(firma)}`;
  const scarichi = {}, ricavi = {};
  let versioneAsc = '1_0';
  for (const giorno of ultimiGiorni(GIORNI)) {
    const url = (versione) => `https://api.appstoreconnect.apple.com/v1/salesReports?${new URLSearchParams({ 'filter[frequency]': 'DAILY', 'filter[reportType]': 'SALES', 'filter[reportSubType]': 'SUMMARY', 'filter[vendorNumber]': E.ASC_VENDOR, 'filter[reportDate]': giorno, 'filter[version]': versione })}`;
    const opz = { headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/a-gzip' } };
    let r;
    try { r = await chiama(url(versioneAsc), opz, 'App Store Connect'); }
    catch (e) {
      if (e.status === 404) continue; // rapporto non ancora pronto o giorno senza vendite
      if (e.status !== 400 || versioneAsc !== '1_0') throw e;
      versioneAsc = '1_1'; // Apple può aver ritirato la 1_0
      try { r = await chiama(url(versioneAsc), opz, 'App Store Connect'); } catch (e2) { if (e2.status === 404) continue; throw e2; }
    }
    const righe = gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8').trim().split('\n').map((l) => l.split('\t'));
    const col = Object.fromEntries(righe[0].map((n, i) => [n.trim(), i]));
    for (const c of righe.slice(1)) {
      const tipo = c[col['Product Type Identifier']], unita = Number(c[col.Units]) || 0;
      if (['1', '1F', '1T', 'F1', '1E', '1EP', '1EU'].includes(tipo)) {
        const app = APPLE[c[col['Apple Identifier']]]; if (!app) continue;
        scarichi[`${giorno}|${app}`] = (scarichi[`${giorno}|${app}`] || 0) + unita;
      } else if (tipo.startsWith('IA') || tipo.startsWith('FI')) {
        const app = appDaProdotto(c[col.SKU]); if (!app) continue;
        const netto = await inEuro(unita * (Number(c[col['Developer Proceeds']]) || 0), c[col['Currency of Proceeds']], giorno);
        ricavi[`${giorno}|${app}`] = (ricavi[`${giorno}|${app}`] || 0) + netto;
      }
    }
    // Un giorno con rapporto vale 0 per le app che non compaiono.
    for (const app of Object.values(APPLE)) scarichi[`${giorno}|${app}`] ??= 0;
  }
  for (const [k, v] of Object.entries(scarichi)) { const [giorno, app] = k.split('|'); download.push({ giorno, app, piattaforma: 'iPhone', download: v }); }
  for (const [k, v] of Object.entries(ricavi)) { const [giorno, app] = k.split('|'); if (v) guadagni.push({ giorno, fonte: 'App Store', app, piattaforma: 'iPhone', importo: tondo(v), valuta: 'EUR' }); }
}

// ---------- Google: token di accesso ----------
async function tokenServizio(scope) {
  const sa = JSON.parse(E.PLAY_SA_JSON);
  const ora = Math.floor(Date.now() / 1000);
  const testa = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = b64url(JSON.stringify({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: ora, exp: ora + 3600 }));
  const firma = createSign('RSA-SHA256').update(`${testa}.${corpo}`).sign(sa.private_key);
  const r = await chiama('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${testa}.${corpo}.${b64url(firma)}` }) }, 'Google (token Play)');
  return (await r.json()).access_token;
}

// ---------- Google Play ----------
async function play() {
  const token = await tokenServizio('https://www.googleapis.com/auth/devstorage.read_only');
  const bucket = E.PLAY_BUCKET.replace(/^gs:\/\//, '').split('/')[0];
  const scarica = async (oggetto) => {
    const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(oggetto)}?alt=media`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Google Play (bucket) ha risposto ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  };
  const mesi = [...new Set(ultimiGiorni(GIORNI).map((g) => g.slice(0, 7).replace('-', '')))];
  const dentro = new Set(ultimiGiorni(GIORNI));
  for (const [pkg, app] of Object.entries(PACCHETTI)) {
    for (const mese of mesi) {
      const buf = await scarica(`stats/installs/installs_${pkg}_${mese}_overview.csv`);
      if (!buf) continue;
      const testo = (buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString('utf16le') : buf.toString('utf8')).replace(/^﻿/, '');
      const [intest, ...righe] = testo.trim().split(/\r?\n/).map((l) => l.split(','));
      const iData = intest.indexOf('Date'), iNuovi = intest.indexOf('Daily User Installs');
      for (const c of righe) if (dentro.has(c[iData])) download.push({ giorno: c[iData], app, piattaforma: 'Android', download: Number(c[iNuovi]) || 0 });
    }
  }
  // Vendite stimate: importo pagato meno le tasse, meno il 15% di commissione di Google.
  const ricavi = {};
  for (const mese of mesi) {
    const zip = await scarica(`sales/salesreport_${mese}.zip`);
    if (!zip) continue;
    const cartella = mkdtempSync(join(tmpdir(), 'vendite-'));
    writeFileSync(join(cartella, 'r.zip'), zip);
    const csv = execFileSync('unzip', ['-p', join(cartella, 'r.zip')], { maxBuffer: 64 << 20 }).toString('utf8').replace(/^﻿/, '');
    rmSync(cartella, { recursive: true, force: true });
    const [intest, ...righe] = csv.trim().split(/\r?\n/).map((l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((x) => x.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')));
    const i = (n) => intest.indexOf(n);
    for (const c of righe) {
      const giorno = c[i('Order Charged Date')], stato = c[i('Financial Status')];
      if (!dentro.has(giorno) || !['Charged', 'Complete'].includes(stato)) continue;
      const app = PACCHETTI[c[i('Product ID')]] || appDaProdotto(c[i('SKU ID')]); if (!app) continue;
      const lordo = (Number(c[i('Charged Amount')]) || 0) - (Number(c[i('Taxes Collected')]) || 0);
      const netto = await inEuro(lordo * 0.85, c[i('Currency of Sale')], giorno);
      ricavi[`${giorno}|${app}`] = (ricavi[`${giorno}|${app}`] || 0) + netto;
    }
  }
  for (const [k, v] of Object.entries(ricavi)) { const [giorno, app] = k.split('|'); if (v) guadagni.push({ giorno, fonte: 'Google Play', app, piattaforma: 'Android', importo: tondo(v), valuta: 'EUR', nota: 'stima' }); }
}

// ---------- AdMob ----------
async function admob() {
  const r = await chiama('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: E.ADMOB_CLIENT_ID, client_secret: E.ADMOB_CLIENT_SECRET, refresh_token: E.ADMOB_REFRESH_TOKEN }) }, 'Google (token AdMob)');
  const token = (await r.json()).access_token;
  const data = (g) => { const [year, month, day] = g.split('-').map(Number); return { year, month, day }; };
  const oggi = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  const pub = E.ADMOB_PUBLISHER.startsWith('pub-') ? E.ADMOB_PUBLISHER : `pub-${E.ADMOB_PUBLISHER}`;
  const rapporto = await (await chiama(`https://admob.googleapis.com/v1/accounts/${pub}/networkReport:generate`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reportSpec: { dateRange: { startDate: data(ultimiGiorni(GIORNI).pop()), endDate: data(oggi) },
      dimensions: ['DATE', 'APP', 'PLATFORM'], metrics: ['ESTIMATED_EARNINGS', 'IMPRESSIONS'], localizationSettings: { currencyCode: 'EUR' } } }),
  }, 'AdMob')).json();
  for (const { row } of rapporto) {
    if (!row) continue;
    const d = row.dimensionValues, m = row.metricValues;
    const g = d.DATE.value, giorno = `${g.slice(0, 4)}-${g.slice(4, 6)}-${g.slice(6, 8)}`;
    const nome = d.APP.displayLabel || '';
    const app = ['Hai pagato?', 'Recevia', 'Slottami', 'Tesserarius', 'Lullabox'].find((a) => nome.toLowerCase().startsWith(a.toLowerCase().replace('?', ''))) || nome;
    const piattaforma = d.PLATFORM.value === 'Android' ? 'Android' : 'iPhone';
    const importo = Number(m.ESTIMATED_EARNINGS?.microsValue || 0) / 1e6, impressioni = Number(m.IMPRESSIONS?.integerValue || 0);
    guadagni.push({ giorno, fonte: 'AdMob', app, piattaforma, importo: tondo(importo), valuta: 'EUR' });
    if (app === 'Hai pagato?') pubblicita.push({ giorno, piattaforma, impressioni });
  }
}

const pronte = {
  'App Store': ['ASC_ISSUER_ID', 'ASC_KEY_ID', 'ASC_PRIVATE_KEY', 'ASC_VENDOR'],
  'Google Play': ['PLAY_SA_JSON', 'PLAY_BUCKET'],
  AdMob: ['ADMOB_CLIENT_ID', 'ADMOB_CLIENT_SECRET', 'ADMOB_REFRESH_TOKEN', 'ADMOB_PUBLISHER'],
};
const lavori = { 'App Store': appStore, 'Google Play': play, AdMob: admob };
for (const [nome, segreti] of Object.entries(pronte)) {
  if (segreti.every((s) => E[s])) await tenta(nome, lavori[nome]);
  else fonti[nome] = 'chiavi mancanti';
}
if (!Object.values(fonti).includes('ok') && !errori.length) {
  console.log('Nessuna chiave configurata: niente da fare.', JSON.stringify(fonti));
  process.exit(0);
}
await scriviCifrato({ aggiornato: new Date().toISOString(), da: 'GitHub (API ufficiali)', fonti, guadagni, download, pubblicita, errori },
  join(repo, 'chiavi.json'), join(repo, 'd', 'api.json'));
console.log(JSON.stringify({ fonti, guadagni: guadagni.length, download: download.length, pubblicita: pubblicita.length, errori }));
