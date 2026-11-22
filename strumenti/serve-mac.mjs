// Uso: node strumenti/serve-mac.mjs
// Dice al controllo del Mac se deve girare: stampa SI quando c'è una richiesta dal bottone
// «Controlla ora» più recente dell'ultima pubblicazione, o quando l'ultima ha più di 55 minuti.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
try { execFileSync('git', ['-C', repo, 'pull', '--rebase', '--quiet']); } catch { /* si decide con quello che c'è */ }
if (!JSON.parse(readFileSync(join(repo, 'chiavi.json'), 'utf8')).length) {
  console.log('NO nessun dispositivo abbinato al cruscotto');
  process.exit(0);
}
const leggi = (f, campo) => existsSync(join(repo, f)) ? Date.parse(JSON.parse(readFileSync(join(repo, f), 'utf8'))[campo]) : 0;
const richiesta = leggi('richiesta.json', 'chiesto');
const ultima = leggi('.ultima-pubblicazione.json', 'at');
const minuti = (Date.now() - ultima) / 60000;
if (richiesta > ultima) console.log('SI richiesta dal bottone');
else if (minuti > 55) console.log(`SI ultima pubblicazione ${Math.round(minuti)} minuti fa`);
else console.log(`NO ultima pubblicazione ${Math.round(minuti)} minuti fa, nessuna richiesta`);
