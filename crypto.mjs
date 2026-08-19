// crypto.mjs —— 离线可用的 AES-GCM 加解密（Node 端，算法与浏览器前端严格一致）
// 密文格式: base64url(salt) + '.' + base64url(iv) + '.' + base64url(ciphertext)
import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const enc = new TextEncoder();
const dec = new TextDecoder();

const SALT_LEN = 16;
const IV_LEN = 12;
const ITER = 150000;

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url');

async function deriveKey(passphrase, salt) {
  const base = await subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptJSON(obj, passphrase) {
  const salt = webcrypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = webcrypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(passphrase, salt);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return `${b64u(salt)}.${b64u(iv)}.${b64u(ct)}`;
}

export async function decryptJSON(payload, passphrase) {
  const [s, i, c] = payload.split('.');
  const salt = unb64u(s);
  const iv = unb64u(i);
  const ct = unb64u(c);
  const key = await deriveKey(passphrase, salt);
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(dec.decode(plain));
}
