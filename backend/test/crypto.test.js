import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
const { encrypt, decrypt } = await import('../src/lib/crypto.js');

test('cifra y descifra de ida y vuelta', () => {
  const secreto = '1//0abcdefgRefreshTokenDeGoogle';
  const cifrado = encrypt(secreto);
  assert.notEqual(cifrado, secreto);
  assert.equal(decrypt(cifrado), secreto);
});

test('cada cifrado usa un IV distinto', () => {
  assert.notEqual(encrypt('mismo'), encrypt('mismo'));
});

test('un valor manipulado falla en vez de devolver basura', () => {
  const [iv, tag, data] = encrypt('secreto').split(':');
  const alterado = [iv, tag, Buffer.from('otracosa').toString('base64')].join(':');
  assert.throws(() => decrypt(alterado));
});
