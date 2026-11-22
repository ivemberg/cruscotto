// Uso: node strumenti/pubblica-mac.mjs "<chi aggiorna>"
// Prende i dataset del controllo marketing sul Mac, li cifra in d/mac.json e li carica su GitHub.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scriviCifrato } from './cifra.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const dati = '/Users/ivo.bettini/.claude/scheduled-tasks/controllo-marketing-app/dati';
const nomi = ['guadagni', 'download', 'pubblicita', 'classifica', 'posizioni', 'attivita',
  'da_fare', 'testate', 'articoli', 'lullabox_mail', 'stato-leggero'];

const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();

const dataset = {};
for (const n of nomi) {
  const f = join(dati, `${n}.json`);
  if (existsSync(f)) dataset[n] = JSON.parse(readFileSync(f, 'utf8'));
}
const chi = process.argv[2] || 'Mac';
const ora = new Date().toISOString();
git('pull', '--rebase', '--quiet');
await scriviCifrato({ aggiornato: ora, da: chi, dataset },
  join(repo, 'chiavi.json'), join(repo, 'd', 'mac.json'));
git('add', 'd/mac.json');
if (git('status', '--porcelain', 'd/mac.json')) {
  git('commit', '--quiet', '-m', `Dati dal Mac (${chi})`);
  git('push', '--quiet');
  console.log('Pubblicato d/mac.json');
  writeFileSync(join(repo, '.ultima-pubblicazione.json'), JSON.stringify({ at: ora }));
} else console.log('Niente da pubblicare');
