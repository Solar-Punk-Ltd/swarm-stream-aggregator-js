import { DeleteMessage, StateEntry } from '../types.js';

import { BaseHandler } from './base.js';
import { HandlerContext, ProcessResult } from './types.js';

export class DeleteHandler extends BaseHandler {
  protected async validate(context: HandlerContext): Promise<ProcessResult> {
    const message = context.message as DeleteMessage;

    if (!message.data || !message.data.topic || !message.data.owner) {
      return { success: false, error: 'Delete message missing topic and owner' };
    }

    const existingEntry = this.stateManager.findEntry(context.previousState, message.data.owner, message.data.topic);
    if (!existingEntry) {
      return { success: false, error: `Entry not found with id: ${message.data.owner}:${message.data.topic}}` };
    }

    return { success: true };
  }

  protected async execute(context: HandlerContext): Promise<StateEntry[]> {
    const message = context.message as DeleteMessage;

    this.logger.info(`Deleting entry with id: ${message.data.owner}:${message.data.topic}`);

    return this.stateManager.deleteEntry(context.previousState, message.data.owner!, message.data.topic!);
  }
}
