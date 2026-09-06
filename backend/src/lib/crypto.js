import crypto from 'crypto';

/**
 * Cifrado simétrico para secretos que sí necesitamos poder volver a leer
 * (el refresh token de Gmail). AES-256-GCM incluye verificación de integridad,
 * así que un valor manipulado falla al descifrar en vez de devolver basura.
 *
 * La llave sale de TOKEN_ENCRYPTION_KEY (32 bytes en hexadecimal).
 */
const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error('Falta TOKEN_ENCRYPTION_KEY');
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY debe ser de 32 bytes en hex');
  return key;
}

/** Devuelve "iv:tag:ciphertext", todo en base64. */
export function encrypt(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64')).join(':');
}

export function decrypt(payload) {
  const [iv, tag, data] = String(payload).split(':').map(p => Buffer.from(p, 'base64'));
  if (!iv || !tag || !data) throw new Error('Formato cifrado inválido');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
