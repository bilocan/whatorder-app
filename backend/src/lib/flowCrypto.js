const crypto = require('crypto');

function decryptRequest(body) {
  const privateKey = (process.env.FLOW_PRIVATE_KEY ?? '')
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '');

  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;

  const aesKey = crypto.privateDecrypt(
    { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(encrypted_aes_key, 'base64'),
  );

  const iv = Buffer.from(initial_vector, 'base64');
  const encryptedBuf = Buffer.from(encrypted_flow_data, 'base64');
  const TAG_LEN = 16;
  const ciphertext = encryptedBuf.slice(0, -TAG_LEN);
  const authTag = encryptedBuf.slice(-TAG_LEN);

  const decipher = crypto.createDecipheriv('aes-128-gcm', aesKey, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return { body: JSON.parse(decrypted.toString('utf8')), aesKey, iv };
}

function encryptResponse(data, aesKey, iv) {
  const flippedIv = Buffer.from(iv).map(b => b ^ 0xff);
  const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, flippedIv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return encrypted.toString('base64');
}

module.exports = { decryptRequest, encryptResponse };
