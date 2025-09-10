import { StateEntry, UpdateMessage } from '../types.js';

import { BaseHandler } from './base.js';
import { HandlerContext, ProcessResult } from './types.js';

export class UpdateHandler extends BaseHandler {
  protected async validate(context: HandlerContext): Promise<ProcessResult> {
    const message = context.message as UpdateMessage;

    if (!message.data || !message.data.owner || !message.data.topic) {
      return { success: false, error: 'Update message missing id' };
    }

    const existingEntry = this.stateManager.findEntry(context.previousState, message.data.owner, message.data.topic);
    if (!existingEntry) {
      return { success: false, error: `Entry not found with id: ${message.data.owner}:${message.data.topic}` };
    }

    return { success: true };
  }

  protected async execute(context: HandlerContext): Promise<StateEntry[]> {
    const message = context.message as UpdateMessage;

    this.logger.info(`Updating entry with id: ${message.data.owner}:${message.data.topic}`);

    return this.stateManager.updateEntry(context.previousState, message.data);
  }
}
