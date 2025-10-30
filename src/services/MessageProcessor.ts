import { Bytes } from '@ethersphere/bee-js';

import { BaseHandler } from '../handlers/base.js';
import { CreateHandler } from '../handlers/create.js';
import { DeleteHandler } from '../handlers/delete.js';
import { ProcessResult } from '../handlers/types.js';
import { UpdateHandler } from '../handlers/update.js';
import { ErrorHandler } from '../libs/error.js';
import { Logger } from '../libs/logger.js';
import { ActionType, Message, StateArrayWithTimestamp } from '../types.js';

import { AuthService } from './AuthService.js';
import { StateManager } from './StateManager.js';

export class MessageProcessor {
  private errorHandler = ErrorHandler.getInstance();
  private logger = Logger.getInstance();
  private authService: AuthService;
  private handlers: Map<ActionType, BaseHandler>;

  constructor(authService: AuthService, stateManager: StateManager) {
    this.authService = authService;

    this.handlers = new Map<ActionType, BaseHandler>([
      [ActionType.CREATE, new CreateHandler(stateManager)],
      [ActionType.UPDATE, new UpdateHandler(stateManager)],
      [ActionType.DELETE, new DeleteHandler(stateManager)],
    ]);
  }

  public async processMessage(messageBytes: Bytes, previousState: StateArrayWithTimestamp): Promise<ProcessResult> {
    try {
      const token = this.parseToken(messageBytes);

      const authResult = this.authService.validateMessage(token);
      if (!authResult.isValid || !authResult.message) {
        const result = { success: false, error: 'Authentication failed' };
        return result;
      }

      const message = authResult.message;
      const actionType = this.verifyActionType(message);

      const handler = this.handlers.get(actionType);
      if (!handler) {
        const result = { success: false, error: `Unknown action type: ${actionType}` };
        return result;
      }

      const result = await handler.handle({
        message,
        previousState,
        logger: this.logger,
      });

      if (result.success) {
        this.logger.info(`Successfully processed ${actionType} action`);
      } else {
        this.errorHandler.handleError(result.error, `MessageProcessor.processMessage[${actionType}]`);
      }

      return result;
    } catch (error) {
      this.errorHandler.handleError(error, 'MessageProcessor.processMessage');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private parseToken(messageBytes: Bytes): string {
    try {
      const tokenString = messageBytes.toUtf8();

      this.logger.debug(`Parsed token: ${tokenString.substring(0, 50)}...`);

      return tokenString;
    } catch (error) {
      throw new Error(`Failed to parse token: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  private verifyActionType(message: Message): ActionType {
    if (message.action && Object.values(ActionType).includes(message.action)) {
      return message.action;
    }

    throw new Error('Action type is missing or invalid in the message');
  }
}
