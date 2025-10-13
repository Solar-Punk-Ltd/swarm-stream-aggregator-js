/**
 * Pauses the execution of an asynchronous function for a specified duration.
 * @param delay - The delay duration in milliseconds.
 * @returns A promise that resolves after the specified delay.
 */
export function sleep(delay: number) {
  return new Promise(resolve => {
    setTimeout(resolve, delay);
  });
}

export function getEnvVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not defined`);
  }
  return value;
}

export function getBooleanEnvVariable(name: string, defaultValue: boolean = false): boolean {
  const value = process.env[name];
  if (!value) {
    return defaultValue;
  }

  const normalizedValue = value.toLowerCase().trim();
  return normalizedValue === 'true';
}

export function getEnvVariableWithDefault(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export function getOptionalEnvVariable(name: string): string | undefined {
  return process.env[name];
}
