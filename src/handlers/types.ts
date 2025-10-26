import { Message, StateArrayWithTimestamp } from '../types.js';

export interface HandlerContext {
  previousState: StateArrayWithTimestamp;
  message: Message;
  logger: any;
}

export interface ProcessResult {
  success: boolean;
  state?: StateArrayWithTimestamp;
  error?: string;
}
