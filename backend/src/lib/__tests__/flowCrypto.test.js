const crypto = require('crypto');

let decryptRequest, encryptResponse;
let privateKeyPem, publicKeyPem;
let aesKey, iv;

beforeAll(() => {
  ({ decryptRequest, encryptResponse } = require('../flowCrypto'));

  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  publicKeyPem  = pair.publicKey.export({ type: 'spki', format: 'pem' });

  aesKey = crypto.randomBytes(16);
  iv     = crypto.randomBytes(16);
});

describe('encryptResponse', () => {
  test('returns a non-empty base64 string', () => {
    const result = encryptResponse({ foo: 'bar' }, aesKey, iv);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(() => Buffer.from(result, 'base64')).not.toThrow();
  });

  test('different ivs produce different ciphertexts', () => {
    const iv2 = crypto.randomBytes(16);
    expect(encryptResponse({ x: 1 }, aesKey, iv)).not.toBe(encryptResponse({ x: 1 }, aesKey, iv2));
  });
});

describe('decryptRequest', () => {
  function buildEncryptedBody(data, key, vector) {
    const encryptedAesKey = crypto.publicEncrypt(
      { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      key,
    );
    const cipher = crypto.createCipheriv('aes-128-gcm', key, vector);
    const encryptedData = Buffer.concat([
      cipher.update(JSON.stringify(data), 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    return {
      encrypted_aes_key:   encryptedAesKey.toString('base64'),
      encrypted_flow_data: encryptedData.toString('base64'),
      initial_vector:      vector.toString('base64'),
    };
  }

  test('decrypts body, returns aesKey and iv', () => {
    process.env.FLOW_PRIVATE_KEY = privateKeyPem;
    const original = { action: 'ping', version: '3.0' };
    const body = buildEncryptedBody(original, aesKey, iv);

    const result = decryptRequest(body);

    expect(result.body).toEqual(original);
    expect(result.aesKey.toString('hex')).toBe(aesKey.toString('hex'));
    expect(result.iv.toString('hex')).toBe(iv.toString('hex'));
  });

  test('handles private key with literal \\n sequences', () => {
    // Keys stored in env vars often have \\n instead of real newlines
    process.env.FLOW_PRIVATE_KEY = privateKeyPem.replace(/\n/g, '\\n');
    const original = { hello: 'world' };
    const body = buildEncryptedBody(original, aesKey, iv);

    const result = decryptRequest(body);
    expect(result.body).toEqual(original);
  });

  test('round-trip: encryptResponse output is valid base64', () => {
    const encrypted = encryptResponse({ status: 'ok' }, aesKey, iv);
    expect(Buffer.from(encrypted, 'base64').length).toBeGreaterThan(16);
  });
});
