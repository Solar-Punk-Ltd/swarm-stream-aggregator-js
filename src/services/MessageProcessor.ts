import { Bytes } from '@ethersphere/bee-js';

import { BaseHandler } from '../handlers/base.js';
import { CreateHandler } from '../handlers/create.js';
import { DeleteHandler } from '../handlers/delete.js';
import { UpdateHandler } from '../handlers/update.js';
import { Logger } from '../libs/logger.js';
import { ActionType, Message, ProcessResult, StateEntry } from '../types.js';

import { AuthService } from './AuthService.js';
import { StateManager } from './StateManager.js';

export class MessageProcessor {
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

  public async processMessage(messageBytes: Bytes, previousState: StateEntry[]): Promise<ProcessResult> {
    try {
      const message = this.parseMessage(messageBytes);

      if (!this.authService.validateMessage(message)) {
        const result = { success: false, error: 'Authentication failed' };
        return result;
      }

      const actionType = this.determineActionType(message);
      message.action = actionType;

      // Get appropriate handler
      const handler = this.handlers.get(actionType);
      if (!handler) {
        const result = { success: false, error: `Unknown action type: ${actionType}` };
        return result;
      }

      const result = await handler.handle({
        previousState,
        message,
        logger: this.logger,
      });

      if (result.success) {
        this.logger.info(`Successfully processed ${actionType} action`);
      } else {
        this.logger.error(`Failed to process ${actionType} action: ${result.error}`);
      }

      return result;
    } catch (error) {
      this.logger.error(`Message processing error: ${error instanceof Error ? error.message : 'Unknown'}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private parseMessage(messageBytes: Bytes): Message {
    try {
      const jsonString = messageBytes.toUtf8();
      const parsed = JSON.parse(jsonString);

      this.logger.debug(`Parsed message: ${JSON.stringify(parsed)}`);

      return parsed as Message;
    } catch (error) {
      throw new Error(`Failed to parse message: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  private determineActionType(message: Message): ActionType {
    if (message.action && Object.values(ActionType).includes(message.action)) {
      return message.action;
    }

    throw new Error('Action type is missing or invalid in the message');
  }
}
