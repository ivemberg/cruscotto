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

// Grafici con ECharts: barre impilate 2D (tocco per i valori, pizzico o trascinamento per scorrere
// i giorni) e vista 3D che si ruota col dito. Il grafico si disegna quando entra nello schermo,
// così l'animazione si vede.
const ha3d = (() => {
  try { return !!window.echarts && !!document.createElement('canvas').getContext('webgl'); } catch { return false; }
})();
const quandoVisibile = new IntersectionObserver((voci) => {
  for (const v of voci) if (v.isIntersecting) { quandoVisibile.unobserve(v.target); v.target._mostra?.(); }
}, { rootMargin: '0px 0px -10% 0px' });

function barre({ giorni, serie, valore, coloreSerie, formato = num, vista = '2d' }) {
  if (!window.echarts) return h('p', { class: 'vuoto' }, 'Grafico non disponibile.');
  const box = h('div', { class: 'grafico' });
  const dati = serie.map((x) => giorni.map((g) => valore(g, x) || 0));
  const asse = (v) => formato === euro ? `${v}€` : num(v);
  const testo = { color: colore('--muted'), fontSize: 10 };
  const linea = { lineStyle: { color: colore('--line') } };
  const suggerimento = { confine: true, backgroundColor: colore('--card'), borderColor: colore('--line'), textStyle: { color: colore('--ink'), fontSize: 12 } };
  let grafico = null;

  const opzioni2d = () => ({
    animationDuration: 900, animationEasing: 'cubicOut', animationDelay: (i) => i * 12,
    grid: { left: 42, right: 8, top: 14, bottom: serie.length > 1 ? 58 : 34 },
    tooltip: { ...suggerimento, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: formato },
    legend: serie.length > 1 ? { bottom: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: colore('--muted'), fontSize: 11 } } : undefined,
    dataZoom: [{ type: 'inside', start: giorni.length > 16 ? 100 * (1 - 16 / giorni.length) : 0, end: 100, zoomOnMouseWheel: false, moveOnMouseWheel: false }],
    xAxis: { type: 'category', data: giorni.map(giornoBreve), axisLabel: { ...testo, hideOverlap: true }, axisLine: linea, axisTick: { show: false } },
    yAxis: { type: 'value', axisLabel: { ...testo, formatter: asse }, splitLine: linea },
    series: serie.map((x, i) => ({ name: x, type: 'bar', stack: 'tot', data: dati[i], barMaxWidth: 22,
      itemStyle: { color: colore(coloreSerie(x)), borderRadius: [3, 3, 0, 0] }, emphasis: { focus: 'series' } })),
  });

  const opzioni3d = () => {
    const punti = [];
    serie.forEach((x, i) => giorni.forEach((g, j) => { if (dati[i][j]) punti.push({ value: [j, i, dati[i][j]], itemStyle: { color: colore(coloreSerie(x)) } }); }));
    return {
      tooltip: { ...suggerimento, formatter: (p) => `${giornoBreve(giorni[p.value[0]])} · ${serie[p.value[1]]}: ${formato(p.value[2])}` },
      xAxis3D: { type: 'category', data: giorni.map(giornoBreve), name: '', axisLabel: { ...testo, interval: Math.max(0, Math.ceil(giorni.length / 7) - 1) } },
      yAxis3D: { type: 'category', data: serie, name: '', axisLabel: { ...testo, interval: 0 } },
      zAxis3D: { type: 'value', name: '', axisLabel: { ...testo, formatter: asse } },
      grid3D: {
        boxWidth: 200, boxDepth: Math.max(40, serie.length * 24), boxHeight: 80,
        axisLine: linea, splitLine: linea, axisPointer: { show: false }, axisTick: { show: false },
        viewControl: { autoRotate: true, autoRotateSpeed: 5, autoRotateAfterStill: 4, distance: box.clientWidth < 500 ? 330 : 250, alpha: 24, beta: 35, panSensitivity: 0 },
        light: { main: { intensity: 1.15, alpha: 40, beta: 30 }, ambient: { intensity: 0.45 } },
      },
      series: [{ type: 'bar3D', data: punti, shading: 'lambert', bevelSize: 0.3, bevelSmoothness: 2,
        emphasis: { label: { show: false } }, animationDurationUpdate: 700 }],
    };
  };

  const disegna = () => {
    if (!grafico) grafico = echarts.init(box, null, { renderer: 'canvas' });
    grafico.clear();
    box.classList.toggle('tre-d', vista === '3d');
    grafico.resize();
    grafico.setOption(vista === '3d' ? opzioni3d() : opzioni2d(), true);
  };
  box._mostra = disegna;
  quandoVisibile.observe(box);
  new ResizeObserver(() => grafico?.resize()).observe(box);

  const scelta = ha3d ? h('div', { class: 'scelta' }, ['2D', '3D'].map((v) => {
    const b = h('button', { type: 'button', class: v.toLowerCase() === vista ? 'attivo' : '', 'aria-pressed': String(v.toLowerCase() === vista) }, v);
    b.addEventListener('click', () => {
      vista = v.toLowerCase();
      for (const x of b.parentNode.children) { x.classList.toggle('attivo', x === b); x.setAttribute('aria-pressed', String(x === b)); }
      disegna();
    });
    return b;
  })) : null;
  if (!ha3d) vista = '2d';
  const aiuto = h('p', { class: 'nota' }, ha3d ? 'Tocca una barra per i valori. In 3D trascina per ruotare, pizzica per avvicinare.' : 'Tocca una barra per i valori; trascina per scorrere i giorni.');
  return h('div', {}, scelta, box, aiuto);
}

// Cifre che contano da zero quando compaiono.
function conta(el, valore, formato) {
  const durata = 900, inizio = performance.now();
  const passo = (t) => {
    const k = Math.min(1, (t - inizio) / durata), e = 1 - (1 - k) ** 3;
    el.textContent = formato(formato === euro ? valore * e : Math.round(valore * e));
    if (k < 1) requestAnimationFrame(passo);
  };
  el._mostra = () => requestAnimationFrame(passo);
  el.textContent = formato(0);
  quandoVisibile.observe(el);
  return el;
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
  const cifra = (v, f, l) => h('div', { class: 'carta cifra' }, conta(h('div', { class: 'n' }), v, f), h('div', { class: 'l' }, l));
  return h('div', { class: 'cifre' },
    cifra(somma(D.guadagni.filter((r) => r.giorno?.startsWith(mese)), 'importo'), euro, 'Guadagni questo mese'),
    cifra(somma(D.guadagni.filter((r) => r.giorno === giorniFa(1)), 'importo'), euro, 'Guadagni ieri'),
    cifra(dl7, num, ultimoDl ? `Download in 7 giorni, fino al ${giornoBreve(ultimoDl)}` : 'Download in 7 giorni'),
    cifra(valutazioni, num, 'Valutazioni su App Store'));
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
    barre({ giorni, serie: app, coloreSerie: (a) => COLORE_APP[a], vista: '3d',
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
  const comparsa = new IntersectionObserver((voci) => { for (const v of voci) if (v.isIntersecting) { v.target.classList.add('visibile'); comparsa.unobserve(v.target); } }, { rootMargin: '0px 0px -5% 0px' });
  for (const sez of main.querySelectorAll('section')) comparsa.observe(sez);
}

(async () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.storage?.persist?.().catch(() => {});
  const disp = await dispositivo();
  document.getElementById('controlla').addEventListener('click', () => controlla(disp));
  await mostra(disp);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') mostra(disp); });
})().catch((e) => { document.getElementById('fresco').textContent = `Errore: ${e.message}`; });
