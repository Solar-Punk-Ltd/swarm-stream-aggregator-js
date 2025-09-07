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

export interface CreateMessage {
  action: ActionType.CREATE;
  data: StateEntry;
}

export interface UpdateMessage {
  action: ActionType.UPDATE;
  data: Partial<StateEntry>;
}

export interface DeleteMessage {
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
