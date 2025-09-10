import { Message, StateEntry } from '../types.js';

export interface HandlerContext {
  previousState: StateEntry[];
  message: Message;
  logger: any;
}

export interface ProcessResult {
  success: boolean;
  state?: StateEntry[];
  error?: string;
}
