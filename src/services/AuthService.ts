import bs58 from 'bs58';
import * as crypto from 'crypto';
import messagepack from 'msgpack-lite';
import * as zlib from 'zlib';

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

interface TokenObject {
  s: string; // signature
  i: string; // instanceId
  p: EncryptedData;
  c: number; // createdAt
  e: number; // expiresAt
}

export interface UserCredentials {
  userId: string;
  userSecret: string;
  instanceId: string;
}

interface DecryptedPayload {
  u: string; // userId
  s: string; // userSecret
  n: string; // nginxSecret
  message: Message;
}

export interface VerifiedToken {
  credentials: UserCredentials;
  message: Message;
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
        message: verifiedToken.message,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn('Token verification failed:', errorMessage);
      return { isValid: false };
    }
  }

  public verifyAndDecrypt(token: string): VerifiedToken {
    const tokenBuffer = bs58.decode(token);
    const tokenObject: TokenObject = messagepack.decode(tokenBuffer);

    if (tokenObject.e < Date.now()) {
      throw new Error('Token expired');
    }

    const decryptedPayload = this.decryptPayload(tokenObject.p, this.apiKey);
    const userSecret = decryptedPayload.s;

    if (!this.verifySignature(tokenObject, userSecret)) {
      throw new Error('Invalid signature');
    }

    return {
      credentials: {
        userId: decryptedPayload.u,
        userSecret: decryptedPayload.s,
        instanceId: tokenObject.i,
      },
      message: decryptedPayload.message,
      instanceId: tokenObject.i,
      createdAt: tokenObject.c,
      expiresAt: tokenObject.e,
    };
  }

  private verifySignature(tokenObject: TokenObject, userSecret: string): boolean {
    const signature = tokenObject.s;

    const dataToSign = {
      i: tokenObject.i,
      p: tokenObject.p,
      c: tokenObject.c,
      e: tokenObject.e,
    };

    const signatureBuffer = messagepack.encode(dataToSign);

    const expectedSignature = crypto.createHmac('sha256', userSecret).update(signatureBuffer).digest('hex');

    return signature === expectedSignature;
  }

  private decryptPayload(encryptedData: EncryptedData, apiKey: string): DecryptedPayload {
    const key = crypto.createHash('sha256').update(apiKey).digest();
    const iv = Buffer.from(encryptedData.iv, 'base64');
    const authTag = Buffer.from(encryptedData.authTag, 'base64');
    const encrypted = Buffer.from(encryptedData.encrypted, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const decryptedBuffer = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    const decompressedBuffer = zlib.inflateSync(decryptedBuffer);

    return messagepack.decode(decompressedBuffer) as DecryptedPayload;
  }
}
