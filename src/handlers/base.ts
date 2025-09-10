import { Logger } from '../libs/logger.js';
import { StateManager } from '../services/StateManager.js';
import { StateEntry } from '../types.js';

import { HandlerContext, ProcessResult } from './types.js';

export abstract class BaseHandler {
  protected logger = Logger.getInstance();
  protected stateManager: StateManager;

  constructor(stateManager: StateManager) {
    this.stateManager = stateManager;
  }

  public async handle(context: HandlerContext): Promise<ProcessResult> {
    try {
      const validationResult = await this.validate(context);
      if (!validationResult.success) {
        return validationResult;
      }

      const state = await this.execute(context);

      return {
        success: true,
        state,
      };
    } catch (error) {
      this.logger.error(`Handler error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  protected abstract validate(context: HandlerContext): Promise<ProcessResult>;
  protected abstract execute(context: HandlerContext): Promise<StateEntry[]>;
}
