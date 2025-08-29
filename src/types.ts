export enum ActionType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
}

export interface BaseMessage {
  action: ActionType;
  signature: string;
  publicKey: string;
}

export interface CreateMessage extends BaseMessage {
  action: ActionType.CREATE;
  data: StateEntry;
}

export interface UpdateMessage extends BaseMessage {
  action: ActionType.UPDATE;
  data: Partial<StateEntry>;
}

export interface DeleteMessage extends BaseMessage {
  action: ActionType.DELETE;
  data: Partial<StateEntry>;
}

export type Message = CreateMessage | UpdateMessage | DeleteMessage;

export interface StateEntry {
  owner: string;
  topic: string;
  title: string;
  state: string;
  index: number;
  duration: number;
  mediaType: string;
  thumbnail?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface ProcessResult {
  success: boolean;
  state?: StateEntry[];
  error?: string;
}

export interface AuthConfig {
  requireAuth: boolean;
  publicKeys?: string[];
}

export interface HandlerContext {
  previousState: StateEntry[];
  message: Message;
  logger: any;
}
