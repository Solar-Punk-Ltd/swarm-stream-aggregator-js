export enum ActionType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
}

export enum MediaType {
  VIDEO = 'video',
  AUDIO = 'audio',
}

export enum StateType {
  LIVE = 'live',
  VOD = 'vod',
  SCHEDULED = 'scheduled',
}

export interface BaseMessage {
  action: ActionType;
  signature: string;
  publicKey: string;
  nonce: string;
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
  state: StateType;
  mediaType: MediaType;
  createdAt?: number;
  updatedAt?: number;
  index?: number;
  duration?: number;
  thumbnail?: string;
  description?: string;
  scheduledStartTime?: string;
}

export interface ProcessResult {
  success: boolean;
  state?: StateEntry[];
  error?: string;
}

export interface AuthConfig {
  requireAuth: boolean;
  publicKeys: string[];
}

export interface HandlerContext {
  previousState: StateEntry[];
  message: Message;
  logger: any;
}
