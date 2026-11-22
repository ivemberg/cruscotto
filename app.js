'use strict';
// Cruscotto app Ivemberg. I dati in d/ sono cifrati: si leggono solo sui dispositivi abbinati,
// con la chiave privata creata qui e salvata in IndexedDB (non esportabile).

const REPO = 'ivemberg/cruscotto';
const WORKFLOW = 'pubblico.yml';
const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' };
const APP = ['Hai pagato?', 'Recevia', 'Slottami', 'Tesserarius', 'Lullabox'];
const COLORE_APP = { 'Hai pagato?': '--c1', Recevia: '--c2', Slottami: '--c3', Tesserarius: '--c4', Lullabox: '--c5' };
const COLORE_FONTE = { AdMob: '--c1', 'App Store': '--c6', 'Google Play': '--c2' };
const COLORE_PIATTAFORMA = { iPhone: '--c6', Android: '--c2' };

// ---------- archivio locale ----------
const apriDb = () => new Promise((ok, ko) => {
  const r = indexedDB.open('cruscotto', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => ok(r.result);
  r.onerror = () => ko(r.error);
});
async function kvGet(k) {
  const d = await apriDb();
  return new Promise((ok, ko) => { const r = d.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
}
async function kvSet(k, v) {
  const d = await apriDb();
  return new Promise((ok, ko) => { const t = d.transaction('kv', 'readwrite'); v === undefined ? t.objectStore('kv').delete(k) : t.objectStore('kv').put(v, k); t.oncomplete = () => ok(); t.onerror = () => ko(t.error); });
}

// ---------- chiavi e cifratura ----------
async function dispositivo() {
  let d = await kvGet('dispositivo');
  if (d) return d;
  const kp = await crypto.subtle.generateKey({ ...RSA, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) }, false, ['encrypt', 'decrypt']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const pub = { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: jwk.alg };
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pub.n)));
  const kid = [...hash.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('');
  d = { kid, priv: kp.privateKey, pub, creato: new Date().toISOString() };
  await kvSet('dispositivo', d);
  return d;
}
const daB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function decifra(busta, d) {
  const k = busta.k?.[d.kid];
  if (!k) return null;
  const raw = await crypto.subtle.decrypt(RSA, d.priv, daB64(k));
  const aes = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const testo = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: daB64(busta.iv) }, aes, daB64(busta.ct));
  return JSON.parse(new TextDecoder().decode(testo));
}
async function carica(nome, disp) {
  try {
    const r = await fetch(`d/${nome}.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return { stato: 'assente' };
    const dati = await decifra(await r.json(), disp);
    return dati ? { stato: 'ok', dati } : { stato: 'non-abbinato' };
  } catch (e) {
    return { stato: 'errore', messaggio: e.message };
  }
}

// ---------- utilità ----------
function h(tag, attr, ...figli) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attr || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const f of figli.flat(Infinity)) if (f != null && f !== false) e.append(f instanceof Node ? f : String(f));
  return e;
}
const SVG = 'http://www.w3.org/2000/svg';
function s(tag, attr) { const e = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attr || {})) e.setAttribute(k, v); return e; }
const colore = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888';
const euro = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n || 0);
const num = (n) => new Intl.NumberFormat('it-IT').format(n || 0);
const giornoBreve = (g) => { const [, m, d] = g.split('-'); return `${+d}/${+m}`; };
const giornoIso = (data) => data.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const giorniFa = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return giornoIso(d); };
const ora = (iso) => new Date(iso).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const link = (url, testo) => /^https?:\/\//.test(url || '') ? h('a', { href: url, target: '_blank', rel: 'noopener' }, testo) : testo;
const somma = (righe, campo) => righe.reduce((a, r) => a + (Number(r[campo]) || 0), 0);
function giorniFino(ultimo, quanti) {
  const out = []; const d = new Date(`${ultimo}T12:00:00`);
  for (let i = quanti - 1; i >= 0; i--) { const x = new Date(d); x.setDate(d.getDate() - i); out.push(x.toISOString().slice(0, 10)); }
  return out;
}
function tabella(intestazioni, righe) {
  return h('div', { class: 'tabella' }, h('table', {},
    h('thead', {}, h('tr', {}, intestazioni.map(([t, c]) => h('th', { class: c }, t)))),
    h('tbody', {}, righe.map((r) => h('tr', {}, r.map((cella, i) => h('td', { class: intestazioni[i][1] }, cella)))))));
}
function sezione(id, titolo, ...contenuto) { return h('section', { id }, h('h2', {}, titolo), ...contenuto); }
const carta = (...c) => h('div', { class: 'carta' }, ...c);

// Barre impilate per giorno. Tocco o passaggio su una barra: dettaglio sotto il grafico.
function barre({ giorni, serie, valore, coloreSerie, formato = num }) {
  const box = h('div', { class: 'grafico' });
  const dettaglio = h('div', { class: 'dettaglio' }, 'Tocca una barra per i dettagli');
  const legenda = h('div', { class: 'legenda' }, serie.map((x) => h('span', {}, h('i', { style: `background:${colore(coloreSerie(x))}` }), x)));
  const totali = giorni.map((g) => serie.reduce((a, x) => a + (valore(g, x) || 0), 0));
  const mostra = (i) => {
    const parti = serie.map((x) => [x, valore(giorni[i], x) || 0]).filter(([, v]) => v);
    dettaglio.textContent = `${giornoBreve(giorni[i])}: ${parti.length ? parti.map(([x, v]) => `${x} ${formato(v)}`).join(' · ') : 'niente'}${parti.length > 1 ? ` · totale ${formato(totali[i])}` : ''}`;
  };
  let larghezza = 0;
  const disegna = () => {
    const W = box.clientWidth; if (!W || W === larghezza) return; larghezza = W;
    const H = 160, L = 38, R = 4, T = 8, B = 20;
    const passo = niceStep(Math.max(...totali, 0));
    const max = passo * 4 || 1;
    const bw = (W - L - R) / giorni.length;
    const y = (v) => T + (H - T - B) * (1 - v / max);
    const g = s('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img' });
    for (let k = 0; k <= 4; k++) {
      const v = passo * k;
      g.append(s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: colore('--line') }));
      const t = s('text', { x: L - 5, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 10, fill: colore('--muted') });
      t.textContent = formato === euro ? (v >= 1 ? `${Math.round(v)}€` : `${v.toFixed(2).replace('.', ',')}€`) : num(v);
      g.append(t);
    }
    const ogni = Math.ceil(giorni.length / Math.max(1, Math.floor((W - L) / 42)));
    giorni.forEach((giorno, i) => {
      const x = L + i * bw;
      let base = 0;
      for (const x2 of serie) {
        const v = valore(giorno, x2) || 0; if (!v) continue;
        g.append(s('rect', { x: x + bw * 0.15, width: Math.max(1, bw * 0.7), y: y(base + v), height: Math.max(0.5, y(base) - y(base + v)), fill: colore(coloreSerie(x2)), rx: 1.5 }));
        base += v;
      }
      if (i % ogni === 0 || i === giorni.length - 1) {
        const ultimo = i === giorni.length - 1;
        const t = s('text', { x: ultimo ? W - R : x + bw / 2, y: H - 5, 'text-anchor': ultimo ? 'end' : 'middle', 'font-size': 10, fill: colore('--muted') });
        t.textContent = giornoBreve(giorno); g.append(t);
      }
      const area = s('rect', { x, y: 0, width: bw, height: H, fill: 'transparent' });
      area.addEventListener('pointerenter', () => mostra(i));
      area.addEventListener('click', () => mostra(i));
      g.append(area);
    });
    box.replaceChildren(g);
  };
  new ResizeObserver(disegna).observe(box);
  return h('div', {}, box, serie.length > 1 ? legenda : null, dettaglio);
}
function niceStep(max) {
  if (max <= 0) return 1;
  const grezzo = max / 4, p = 10 ** Math.floor(Math.log10(grezzo));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= grezzo) return m * p;
  return 10 * p;
}

// ---------- sezioni ----------
// Le righe delle API ufficiali sostituiscono quelle del Mac con la stessa chiave; le altre restano.
function sovrapponi(base, sopra, chiave) {
  const m = new Map((base || []).map((r) => [chiave(r), r]));
  for (const r of sopra || []) m.set(chiave(r), r);
  return [...m.values()];
}

function unisci(M, P, A) {
  const d = M?.dataset || {};
  const classifica = [...(d.classifica || [])];
  for (const r of P?.classifica || []) {
    const i = classifica.findIndex((x) => x.data === r.data && x.app === r.app);
    // Con 100 letti un null vuol dire solo «oltre i primi 100»: non copre un numero già noto.
    if (r.posizione == null && r.letti < 200 && i >= 0 && classifica[i].posizione != null) continue;
    if (i >= 0) classifica[i] = r; else classifica.push(r);
  }
  const pNuovo = P && (!M || P.aggiornato > M.aggiornato);
  return {
    guadagni: sovrapponi(d.guadagni, A?.guadagni, (r) => `${r.giorno}|${r.fonte}|${r.app}|${r.piattaforma}`),
    download: sovrapponi(d.download, A?.download, (r) => `${r.giorno}|${r.app}|${r.piattaforma}`),
    pubblicita: sovrapponi(d.pubblicita, A?.pubblicita, (r) => `${r.giorno}|${r.piattaforma}`),
    classifica, posizioni: pNuovo && P.posizioni?.length ? P.posizioni : (d.posizioni || []),
    attivita: d.attivita || [], da_fare: d.da_fare || [], testate: d.testate || [],
    articoli: d.articoli || [], lullabox_mail: d.lullabox_mail || [],
    ios: P?.ios || [], stato: d['stato-leggero'] || {}, fonti: A?.fonti || null, erroriApi: A?.errori || [],
  };
}

function riepilogo(D) {
  const mese = giornoIso(new Date()).slice(0, 7);
  const ultimoDl = D.download.map((r) => r.giorno).sort().pop();
  const dl7 = ultimoDl ? somma(D.download.filter((r) => giorniFino(ultimoDl, 7).includes(r.giorno)), 'download') : 0;
  const valutazioni = D.ios.length ? somma(D.ios, 'valutazioni') : Object.values(D.stato.valutazioni_ios || {}).reduce((a, b) => a + b, 0);
  const cifra = (n, l) => h('div', { class: 'carta cifra' }, h('div', { class: 'n' }, n), h('div', { class: 'l' }, l));
  return h('div', { class: 'cifre' },
    cifra(euro(somma(D.guadagni.filter((r) => r.giorno?.startsWith(mese)), 'importo')), 'Guadagni questo mese'),
    cifra(euro(somma(D.guadagni.filter((r) => r.giorno === giorniFa(1)), 'importo')), 'Guadagni ieri'),
    cifra(num(dl7), ultimoDl ? `Download in 7 giorni, fino al ${giornoBreve(ultimoDl)}` : 'Download in 7 giorni'),
    cifra(num(valutazioni), 'Valutazioni su App Store'));
}

function guadagni(D) {
  if (!D.guadagni.length) return sezione('guadagni', 'Guadagni', carta(h('p', { class: 'vuoto' },
    'Ancora nessun dato. I controlli sul Mac leggono i guadagni stimati di AdMob e, dal 1° dicembre, gli acquisti su App Store e Google Play.')));
  const ultimo = D.guadagni.map((r) => r.giorno).sort().pop();
  const giorni = giorniFino(ultimo, 30);
  const fonti = [...new Set(D.guadagni.map((r) => r.fonte))];
  const mese = ultimo.slice(0, 7);
  const delMese = D.guadagni.filter((r) => r.giorno.startsWith(mese));
  const chiavi = [...new Set(delMese.map((r) => `${r.app}|${r.fonte}`))];
  return sezione('guadagni', 'Guadagni', carta(
    barre({ giorni, serie: fonti, formato: euro, coloreSerie: (f) => COLORE_FONTE[f] || '--c3',
      valore: (g, f) => somma(D.guadagni.filter((r) => r.giorno === g && r.fonte === f), 'importo') }),
    h('p', { class: 'nota' }, `Mese di ${new Date(`${mese}-15`).toLocaleDateString('it-IT', { month: 'long' })}`),
    tabella([['App'], ['Fonte'], ['Importo', 'num']], chiavi.map((k) => {
      const [app, fonte] = k.split('|');
      return [app, fonte, euro(somma(delMese.filter((r) => r.app === app && r.fonte === fonte), 'importo'))];
    })),
    h('p', { class: 'nota' }, 'AdMob dà guadagni stimati; App Store e Google Play danno i ricavi già al netto della commissione, con qualche giorno di ritardo.')));
}

function download(D) {
  if (!D.download.length) return sezione('download', 'Download', carta(h('p', { class: 'vuoto' }, 'Nessun dato.')));
  const ultimo = D.download.map((r) => r.giorno).sort().pop();
  const giorni = giorniFino(ultimo, 30);
  const sette = giorniFino(ultimo, 7);
  const app = APP.filter((a) => D.download.some((r) => r.app === a && r.download));
  return sezione('download', 'Download', carta(
    barre({ giorni, serie: app, coloreSerie: (a) => COLORE_APP[a],
      valore: (g, a) => somma(D.download.filter((r) => r.giorno === g && r.app === a), 'download') }),
    h('p', { class: 'nota' }, `Ultimi 7 giorni con dati (fino al ${giornoBreve(ultimo)})`),
    tabella([['App'], ['iPhone', 'num'], ['Android', 'num'], ['Totale', 'num']], APP.map((a) => {
      const r = D.download.filter((x) => x.app === a && sette.includes(x.giorno));
      const i = somma(r.filter((x) => x.piattaforma === 'iPhone'), 'download'), an = somma(r.filter((x) => x.piattaforma === 'Android'), 'download');
      return [a, num(i), num(an), num(i + an)];
    })),
    h('p', { class: 'nota' }, 'App Store arriva con 1–2 giorni di ritardo, Google Play con 4–5.')));
}

function app(D) {
  const oggi = giornoIso(new Date());
  const pos = (a) => {
    const righe = D.classifica.filter((r) => r.app === a).sort((x, y) => x.data.localeCompare(y.data));
    const r = righe.pop(); if (!r) return '—';
    const prima = righe.reverse().find((x) => x.data < r.data);
    const testo = r.posizione ? `${r.posizione}ª` : (r.letti && r.letti < 200 ? 'oltre 100' : 'oltre 200');
    const freccia = r.posizione && prima?.posizione ? (prima.posizione > r.posizione ? ` ↑${prima.posizione - r.posizione}` : prima.posizione < r.posizione ? ` ↓${r.posizione - prima.posizione}` : '') : '';
    return `${testo}${freccia}${r.data !== oggi ? ` (${giornoBreve(r.data)})` : ''}`;
  };
  return sezione('app', 'App', carta(tabella(
    [['App'], ['Versione iOS'], ['Valutazioni iOS', 'num'], ['Classifica'], ['Recensioni Play', 'num']],
    APP.map((a) => {
      const i = D.ios.find((x) => x.app === a);
      const val = i ? `${num(i.valutazioni)}${i.media ? ` · ${i.media.toFixed(1).replace('.', ',')}★` : ''}` : num(D.stato.valutazioni_ios?.[a]);
      const play = D.stato.recensioni_play?.[a];
      return [a, i?.versione || D.stato.versioni_ios?.[a] || '—', val, pos(a), play == null ? '—' : num(play)];
    })),
  h('p', { class: 'nota' }, 'Classifica App Store Italia, app gratis della categoria di ciascuna.')));
}

function pubblicita(D) {
  if (!D.pubblicita.length) return null;
  const ultimo = D.pubblicita.map((r) => r.giorno).sort().pop();
  const giorni = giorniFino(ultimo, 14);
  return sezione('pubblicita', 'Pubblicità di Hai pagato?', carta(
    barre({ giorni, serie: ['iPhone', 'Android'], coloreSerie: (p) => COLORE_PIATTAFORMA[p],
      valore: (g, p) => somma(D.pubblicita.filter((r) => r.giorno === g && r.piattaforma === p), 'impressioni') }),
    h('p', { class: 'nota' }, 'Impressioni del banner al giorno, da AdMob. Il giorno in corso è parziale.')));
}

function ricerche(D) {
  if (!D.posizioni.length) return null;
  return sezione('ricerche', 'Ricerche su Google Play', carta(
    tabella([['App'], ['Parola'], ['Posizione', 'num']], D.posizioni.map((r) => [r.app, r.parola, r.posizione ? `${r.posizione}ª` : 'non c\'è'])),
    h('p', { class: 'nota' }, `Ricerca in Italia, controllata il ${giornoBreve(D.posizioni[0].data)}.`)));
}

function daFare(D) {
  const ordine = { Alta: 0, Media: 1, Bassa: 2 };
  const righe = [...D.da_fare].sort((a, b) => (ordine[a.priorita] ?? 3) - (ordine[b.priorita] ?? 3));
  return sezione('dafare', 'Da fare', carta(righe.length ? h('ul', { class: 'lista' }, righe.map((r) => h('li', {},
    h('div', { class: 'su' }, h('span', { class: `etichetta ${r.priorita === 'Alta' ? 'alta' : ''}` }, r.priorita), ' ', r.app),
    h('div', {}, r.cosa), r.link ? h('div', { class: 'su' }, link(r.link, 'Apri')) : null))) : h('p', { class: 'vuoto' }, 'Niente da fare.')));
}

function attivita(D) {
  const voce = (r) => h('li', {}, h('div', { class: 'su' }, `${giornoBreve(r.data)} · ${r.app} · ${r.canale}`), h('div', {}, r.cosa), r.risultato ? h('div', { class: 'su' }, r.risultato) : null);
  const prime = D.attivita.slice(0, 12), altre = D.attivita.slice(12);
  return sezione('attivita', 'Attività', carta(h('ul', { class: 'lista' }, prime.map(voce)),
    altre.length ? h('details', {}, h('summary', {}, `Mostra le altre ${altre.length}`), h('ul', { class: 'lista' }, altre.map(voce))) : null));
}

function stampa(D) {
  const stato = (t) => h('span', { class: `etichetta ${t === 'Pubblicato' ? 'ok' : ''}` }, t);
  return sezione('stampa', 'Stampa',
    D.articoli.length ? carta(h('ul', { class: 'lista' }, D.articoli.map((r) => h('li', {},
      h('div', { class: 'su' }, `${giornoBreve(r.data)} · ${r.testata} · ${r.tipo}`), h('div', {}, link(r.url, r.titolo)))))) : null,
    h('h2', { style: 'margin-top:16px' }, 'Testate di Hai pagato?'),
    carta(tabella([['Testata'], ['Stato'], ['Contatto'], ['Nota']], D.testate.map((r) => [r.testata, stato(r.stato), r.ultimo_contatto ? giornoBreve(r.ultimo_contatto) : '', r.nota || '']))),
    D.lullabox_mail.length ? [h('h2', { style: 'margin-top:16px' }, 'Contatti di Lullabox'),
      carta(tabella([['Contatto'], ['Stato'], ['Ultimo'], ['Nota']], D.lullabox_mail.map((r) => [r.contatto, stato(r.stato), r.ultimo_contatto ? giornoBreve(r.ultimo_contatto) : '', r.nota || ''])))] : null);
}

function testoChiave(disp) { return JSON.stringify({ kid: disp.kid, jwk: disp.pub }); }
function cartaChiave(disp, titolo, spiegazione) {
  const esito = h('span', { class: 'su' });
  const copia = async () => {
    try { await navigator.clipboard.writeText(testoChiave(disp)); esito.textContent = ' Copiata.'; } catch { esito.textContent = ' Selezionala e copiala a mano.'; }
  };
  const condividi = navigator.share ? h('button', { class: 'secondario', type: 'button', onclick: () => navigator.share({ text: testoChiave(disp) }).catch(() => {}) }, 'Condividi') : null;
  return carta(h('h2', {}, titolo), h('p', {}, spiegazione), h('div', { class: 'chiave' }, testoChiave(disp)),
    h('div', { class: 'riga', style: 'margin-top:10px' }, h('button', { type: 'button', onclick: copia }, 'Copia la chiave'), condividi, esito),
    h('p', { class: 'nota' }, `Dispositivo ${disp.kid}. È la chiave pubblica: non è segreta e serve solo a cifrare i dati per questo dispositivo.`));
}

async function impostazioni(disp, D) {
  const token = await kvGet('token');
  const campo = h('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off' });
  const esito = h('p', { class: 'nota' }, token ? 'Token salvato su questo dispositivo.' : 'Nessun token: il bottone «Controlla ora» non può partire.');
  const salva = async () => {
    const v = campo.value.trim(); if (!v) return;
    await kvSet('token', v); campo.value = ''; esito.textContent = 'Token salvato su questo dispositivo.';
  };
  const togli = async () => { await kvSet('token', undefined); esito.textContent = 'Token tolto.'; };
  const stati = { ok: 'collegato', errore: 'errore', 'chiavi mancanti': 'non ancora collegato' };
  const api = carta(h('h2', {}, 'API ufficiali'),
    D.fonti ? tabella([['Fonte'], ['Stato']], Object.entries(D.fonti).map(([f, st]) => [f, h('span', { class: `etichetta ${st === 'ok' ? 'ok' : st === 'errore' ? 'alta' : ''}` }, stati[st] || st)]))
      : h('p', { class: 'vuoto' }, 'Nessuna API collegata: guadagni e download arrivano dai controlli sul Mac.'),
    D.erroriApi.length ? h('p', { class: 'nota' }, D.erroriApi.join(' · ')) : null,
    h('p', { class: 'nota' }, 'Quando un\'API è collegata, i suoi numeri sostituiscono quelli letti dal Mac per gli stessi giorni; il resto resta.'));
  return sezione('impostazioni', 'Impostazioni', api, h('div', { style: 'height:10px' }),
    carta(h('h2', {}, 'Bottone «Controlla ora»'),
      h('p', {}, 'Serve un token di GitHub che possa solo avviare il controllo di questo repository. Lo crei tu su GitHub e lo incolli qui: resta su questo dispositivo.'),
      h('ol', { class: 'nota' },
        h('li', {}, 'Apri ', link('https://github.com/settings/personal-access-tokens/new', 'il nuovo token a grana fine'), '.'),
        h('li', {}, 'Repository access: «Only select repositories» → ivemberg/cruscotto.'),
        h('li', {}, 'Permissions → Actions: «Read and write». Nient\'altro.'),
        h('li', {}, 'Scadenza a piacere, poi «Generate token» e incollalo qui.')),
      campo, h('div', { class: 'riga', style: 'margin-top:10px' }, h('button', { type: 'button', onclick: salva }, 'Salva'), h('button', { class: 'secondario', type: 'button', onclick: togli }, 'Togli')), esito),
    h('div', { style: 'height:10px' }),
    h('details', {}, h('summary', {}, 'Chiave di questo dispositivo'), cartaChiave(disp, 'Chiave del dispositivo', 'Per abbinare questo dispositivo di nuovo, se serve.')));
}

// ---------- bottone «Controlla ora» ----------
const attesa = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function controlla(disp) {
  const btn = document.getElementById('controlla');
  const fresco = document.getElementById('fresco');
  const token = await kvGet('token');
  if (!token) { fresco.textContent = 'Per il bottone serve un token: vedi Impostazioni in fondo.'; location.hash = '#impostazioni'; return; }
  const api = (path, opz = {}) => fetch(`https://api.github.com/repos/${REPO}${path}`, { ...opz, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
  btn.disabled = true; btn.textContent = 'Avvio…';
  const inizio = Date.now();
  try {
    const r = await api(`/actions/workflows/${WORKFLOW}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
    if (r.status !== 204) throw new Error(r.status === 401 ? 'token non valido o scaduto' : `GitHub ha risposto ${r.status}: controlla i permessi del token`);
    btn.textContent = 'In corso…';
    fresco.textContent = 'Controllo avviato su GitHub. Il Mac raccoglie la richiesta al prossimo giro, se è acceso.';
    let finito = false;
    for (let i = 0; i < 30 && !finito; i++) {
      await attesa(8000);
      const runs = await (await api('/actions/runs?event=workflow_dispatch&per_page=3')).json();
      const run = runs.workflow_runs?.find((x) => Date.parse(x.created_at) > inizio - 60000);
      if (run?.status === 'completed') {
        if (run.conclusion !== 'success') throw new Error(`il controllo su GitHub è finito con «${run.conclusion}»`);
        finito = true;
      }
    }
    btn.textContent = 'Pubblico…';
    for (let i = 0; i < 24; i++) {
      const p = await carica('pubblico', disp);
      if (p.stato === 'ok' && Date.parse(p.dati.aggiornato) > inizio) break;
      await attesa(10000);
    }
    await mostra(disp);
  } catch (e) {
    fresco.textContent = `Controllo non riuscito: ${e.message}.`;
  } finally {
    btn.disabled = false; btn.textContent = 'Controlla ora';
  }
}

// ---------- avvio ----------
async function mostra(disp) {
  const main = document.getElementById('main');
  const fresco = document.getElementById('fresco');
  const [m, p, a] = await Promise.all([carica('mac', disp), carica('pubblico', disp), carica('api', disp)]);
  if (m.stato === 'non-abbinato' || (m.stato !== 'ok' && p.stato === 'non-abbinato')) {
    fresco.textContent = 'Dispositivo non abbinato';
    main.replaceChildren(cartaChiave(disp, 'Abbina questo dispositivo',
      'I dati sono cifrati e si leggono solo sui dispositivi abbinati. Copia la chiave qui sotto e mandala a Claude nella chat: la aggiunge al cruscotto e i dati compaiono qui al prossimo aggiornamento. Su iPhone fallo dall\'icona nella schermata Home, non da Safari, perché sono due archivi diversi.'));
    return;
  }
  if (m.stato !== 'ok' && p.stato !== 'ok') {
    fresco.textContent = 'Dati non disponibili';
    main.replaceChildren(carta(h('p', {}, m.stato === 'errore' ? `Errore: ${m.messaggio}` : 'Non ci sono ancora dati pubblicati.')),
      h('div', { style: 'height:12px' }), cartaChiave(disp, 'Chiave di questo dispositivo', 'Se il dispositivo non è ancora abbinato, copia la chiave e mandala a Claude nella chat.'));
    return;
  }
  const M = m.stato === 'ok' ? m.dati : null, P = p.stato === 'ok' ? p.dati : null, A = a.stato === 'ok' ? a.dati : null;
  const parti = [];
  if (M) {
    const ore = (Date.now() - Date.parse(M.aggiornato)) / 3600000;
    parti.push(`Mac: ${ora(M.aggiornato)}${ore > 2 ? ` (fermo da ${Math.round(ore)} ore, forse in stop)` : ''}`);
  }
  if (P) parti.push(`Pubblici: ${ora(P.aggiornato)}`);
  if (A) parti.push(`API: ${ora(A.aggiornato)}`);
  fresco.textContent = parti.join(' · ');
  const D = unisci(M, P, A);
  main.replaceChildren(...[riepilogo(D), guadagni(D), download(D), app(D), pubblicita(D), ricerche(D), daFare(D), attivita(D), stampa(D), await impostazioni(disp, D)].filter(Boolean));
  document.getElementById('menu').hidden = false;
}

(async () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.storage?.persist?.().catch(() => {});
  const disp = await dispositivo();
  document.getElementById('controlla').addEventListener('click', () => controlla(disp));
  await mostra(disp);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') mostra(disp); });
})().catch((e) => { document.getElementById('fresco').textContent = `Errore: ${e.message}`; });
