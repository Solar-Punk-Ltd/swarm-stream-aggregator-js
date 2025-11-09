export class Logger {
  private static instance: Logger;

  private constructor() {}

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private formatMessage(level: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.map(arg => this.formatArgument(arg)).join(' ');
    return `[${timestamp}] [${level.toUpperCase()}] - ${formattedArgs}`;
  }

  private formatArgument(arg: any): string {
    if (arg === null) return 'null';
    if (arg === undefined) return 'undefined';
    if (typeof arg !== 'object') return String(arg);

    if (arg instanceof Error) {
      return this.formatError(arg);
    }

    return this.formatObject(arg);
  }

  private formatError(error: Error): string {
    const base = `${error.name}: ${error.message}`;
    return error.stack ? `${base}\n${error.stack}` : base;
  }

  private formatObject(obj: object): string {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      // Fallback for circular references or non-serializable objects
      return this.formatComplexObject(obj);
    }
  }

  private formatComplexObject(obj: object): string {
    try {
      const className = obj.constructor?.name || 'Object';
      const keys = Object.keys(obj);

      if (keys.length === 0) {
        return `[${className}]`;
      }

      const MAX_PREVIEW_KEYS = 5;
      const previewKeys = keys.slice(0, MAX_PREVIEW_KEYS);
      const preview = previewKeys.map(key => `${key}: ${typeof obj[key as keyof object]}`).join(', ');

      const hasMore = keys.length > MAX_PREVIEW_KEYS;
      return `[${className}] { ${preview}${hasMore ? ', ...' : ''} }`;
    } catch {
      return '[Unserializable Object]';
    }
  }

  log(...args: any[]): void {
    console.log(this.formatMessage('log', ...args));
  }

  info(...args: any[]): void {
    console.info(this.formatMessage('info', ...args));
  }

  warn(...args: any[]): void {
    console.warn(this.formatMessage('warn', ...args));
  }

  error(...args: any[]): void {
    console.error(this.formatMessage('error', ...args));
  }

  debug(...args: any[]): void {
    console.debug(this.formatMessage('debug', ...args));
  }
}
