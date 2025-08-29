import { CreateMessage, HandlerContext, ProcessResult, StateEntry } from '../types.js';

import { BaseHandler } from './base.js';

export class CreateHandler extends BaseHandler {
  protected async validate(context: HandlerContext): Promise<ProcessResult> {
    const message = context.message as CreateMessage;

    if (!message.data) {
      return { success: false, error: 'Create message missing data' };
    }

    if (!this.stateManager.validateEntry(message.data)) {
      return { success: false, error: 'Invalid entry data' };
    }

    return { success: true };
  }

  protected async execute(context: HandlerContext): Promise<StateEntry[]> {
    const message = context.message as CreateMessage;

    this.logger.info(`Creating new entry with id: ${message.data.owner}:${message.data.topic}`);

    return this.stateManager.createEntry(context.previousState, message.data);
  }
}
