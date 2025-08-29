import { Signature } from '@ethersphere/bee-js';

import { Logger } from '../libs/logger.js';
import { AuthConfig, Message } from '../types.js';

export class AuthService {
  private logger = Logger.getInstance();
  private validPublicKeys: Set<string>;
  private requireAuth: boolean;

  constructor(config: AuthConfig) {
    this.requireAuth = config.requireAuth;
    this.validPublicKeys = new Set(config.publicKeys || []);
  }

  public validateMessage(message: Message): boolean {
    // Legacy messages bypass auth if requireAuth is false
    if (!message.action && !this.requireAuth) {
      return true;
    }

    if (!message.signature || !message.publicKey) {
      this.logger.warn('Message rejected: missing signature or public key');
      return false;
    }

    if (this.validPublicKeys.size > 0 && !this.validPublicKeys.has(message.publicKey)) {
      this.logger.warn('Message rejected: unauthorized public key');
      return false;
    }

    try {
      const isValid = this.verifySignature(message, message.signature, message.publicKey);

      if (!isValid) {
        this.logger.warn('Message rejected: invalid signature');
        return false;
      }

      this.logger.debug('Message authenticated successfully', {
        publicKey: message.publicKey.substring(0, 10) + '...',
      });

      return true;
    } catch (error) {
      this.logger.error('Signature verification failed:', error);
      return false;
    }
  }

  private verifySignature(message: Message, signature: string, publicKey: string): boolean {
    try {
      const sig = new Signature(signature);
      return sig.isValid(JSON.stringify(message), publicKey);
    } catch (error) {
      this.logger.error('Error verifying signature:', error);
      return false;
    }
  }
}
