import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError } from './types.js';

export class ConfigSecrets {
  private readonly key?: Buffer;

  constructor(encodedKey?: string) {
    if (!encodedKey) return;
    const key = Buffer.from(encodedKey, 'base64');
    if (key.length !== 32 || key.toString('base64') !== encodedKey) throw new AppError('invalid_config', 'CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    this.key = key;
  }

  encrypt(secret: string): string {
    if (!this.key) throw new AppError('invalid_config', 'Set CONFIG_ENCRYPTION_KEY before saving a provider API key', 503);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64');
  }

  decrypt(encoded: string): string {
    if (!this.key) throw new AppError('invalid_config', 'CONFIG_ENCRYPTION_KEY is required to use a provider API key', 503);
    try {
      const data = Buffer.from(encoded, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
    } catch {
      throw new AppError('invalid_config', 'Provider API key cannot be decrypted with CONFIG_ENCRYPTION_KEY', 503);
    }
  }
}
