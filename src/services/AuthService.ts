import * as crypto from 'crypto';

import { Logger } from '../libs/logger.js';
import { Message } from '../types.js';

export interface AuthConfig {
  requireAuth: boolean;
  apiKey: string;
}

interface EncryptedData {
  encrypted: string;
  iv: string;
  authTag: string;
}

interface TokenData {
  instanceId: string;
  encryptedPayload: EncryptedData;
  createdAt: number;
  expiresAt: number;
  signature: string;
}

interface UserCredentials {
  userId: string;
  userSecret: string;
  instanceId: string;
}

interface DecryptedPayload {
  credentials: UserCredentials;
  data: string;
  signatureData: {
    instanceId: string;
    createdAt: number;
    expiresAt: number;
  };
}

interface VerifiedToken {
  credentials: UserCredentials;
  data: Message;
  instanceId: string;
  createdAt: number;
  expiresAt: number;
}

export class AuthService {
  private apiKey: string;
  private logger = Logger.getInstance();
  private requireAuth: boolean;

  constructor(config: AuthConfig) {
    this.apiKey = config.apiKey;
    this.requireAuth = config.requireAuth;
  }

  public validateMessage(token: string): { isValid: boolean; message?: Message } {
    if (!this.requireAuth) {
      this.logger.warn('Auth not required!');
      return { isValid: true };
    }

    try {
      const verifiedToken = this.verifyAndDecrypt(token);

      this.logger.debug('Message authenticated successfully with token-based auth', {
        userId: verifiedToken.credentials.userId,
        instanceId: verifiedToken.instanceId,
      });

      return {
        isValid: true,
        message: verifiedToken.data,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn('Token verification failed:', errorMessage);
      return { isValid: false };
    }
  }

  public verifyAndDecrypt(token: string): VerifiedToken {
    const tokenData: TokenData = JSON.parse(Buffer.from(token, 'base64').toString());

    if (tokenData.expiresAt < Date.now()) {
      throw new Error('Token expired');
    }

    const decryptedPayload = this.decryptPayload(tokenData.encryptedPayload, this.apiKey);

    if (!this.verifySignature(tokenData, decryptedPayload.credentials.userSecret)) {
      throw new Error('Invalid signature');
    }

    if (
      decryptedPayload.signatureData.instanceId !== tokenData.instanceId ||
      decryptedPayload.signatureData.createdAt !== tokenData.createdAt ||
      decryptedPayload.signatureData.expiresAt !== tokenData.expiresAt
    ) {
      throw new Error('Token metadata mismatch');
    }

    return {
      credentials: decryptedPayload.credentials,
      data: JSON.parse(decryptedPayload.data) as Message,
      instanceId: tokenData.instanceId,
      createdAt: tokenData.createdAt,
      expiresAt: tokenData.expiresAt,
    };
  }

  private verifySignature(tokenData: TokenData, userSecret: string): boolean {
    const signature = tokenData.signature;

    const dataToSign = {
      instanceId: tokenData.instanceId,
      encryptedPayload: tokenData.encryptedPayload,
      createdAt: tokenData.createdAt,
      expiresAt: tokenData.expiresAt,
    };

    const expectedSignature = crypto.createHmac('sha256', userSecret).update(JSON.stringify(dataToSign)).digest('hex');

    return signature === expectedSignature;
  }

  private decryptPayload(encryptedData: EncryptedData, apiKey: string): DecryptedPayload {
    const algorithm = 'aes-256-gcm';
    const key = crypto.createHash('sha256').update(apiKey).digest();

    const iv = Buffer.from(encryptedData.iv, 'base64');
    const authTag = Buffer.from(encryptedData.authTag, 'base64');
    const encrypted = Buffer.from(encryptedData.encrypted, 'base64');

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    return JSON.parse(decrypted.toString('utf8')) as DecryptedPayload;
  }
}
