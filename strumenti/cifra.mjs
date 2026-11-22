// Cifra un oggetto per tutti i dispositivi abbinati in chiavi.json.
// AES-256-GCM per i dati; la chiave AES è cifrata con la chiave pubblica RSA-OAEP di ogni dispositivo.
// Qui servono solo le chiavi pubbliche: le chiavi private restano sui dispositivi.
import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
const { subtle } = webcrypto;
const getRandomValues = (a) => webcrypto.getRandomValues(a);

const b64 = (buf) => Buffer.from(buf).toString('base64');
const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' };

export async function cifra(oggetto, fileChiavi) {
  const chiavi = JSON.parse(readFileSync(fileChiavi, 'utf8'));
  if (!chiavi.length) throw new Error('Nessun dispositivo abbinato in chiavi.json');
  const aes = getRandomValues(new Uint8Array(32));
  const iv = getRandomValues(new Uint8Array(12));
  const chiaveAes = await subtle.importKey('raw', aes, 'AES-GCM', false, ['encrypt']);
  const testo = new TextEncoder().encode(JSON.stringify(oggetto));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, chiaveAes, testo);
  const k = {};
  for (const { kid, jwk } of chiavi) {
    const pub = await subtle.importKey('jwk', jwk, RSA, false, ['encrypt']);
    k[kid] = b64(await subtle.encrypt(RSA, pub, aes));
  }
  return { v: 1, iv: b64(iv), k, ct: b64(ct) };
}

export async function scriviCifrato(oggetto, fileChiavi, destinazione) {
  writeFileSync(destinazione, JSON.stringify(await cifra(oggetto, fileChiavi)));
}
