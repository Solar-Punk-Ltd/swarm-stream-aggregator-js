import * as crypto from 'crypto';

import { Logger } from '../libs/logger.js';
import { AuthConfig, Message } from '../types.js';

// TODO: adjust to curr arch
export class AuthService {
  private logger = Logger.getInstance();
  private validKeys: Set<string>;
  private requireAuth: boolean;

  constructor(config: AuthConfig) {
    this.requireAuth = config.requireAuth;
    this.validKeys = new Set(config.keys.map(key => this.hashKey(key)));
  }

  public validateMessage(message: Message): boolean {
    // Legacy messages bypass auth if requireAuth is false
    if (!message.action && !this.requireAuth) {
      return true;
    }

    // All non-legacy messages require auth
    if (!message.key) {
      this.logger.warn('Message rejected: missing authentication key');
      return false;
    }

    const hashedKey = this.hashKey(message.key);

    if (!this.validKeys.has(hashedKey)) {
      this.logger.warn('Message rejected: invalid authentication key');
      return false;
    }

    this.logger.debug('Message authenticated successfully');
    return true;
  }

  private hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }
}
