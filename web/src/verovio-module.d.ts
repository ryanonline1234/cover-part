declare module "verovio/wasm" {
  const createVerovioModule: () => Promise<unknown>;
  export default createVerovioModule;
}

declare module "verovio/esm" {
  export const LOG_OFF: number;
  export const LOG_ERROR: number;
  export const LOG_WARNING: number;
  export function enableLog(level: number, module: unknown): void;
  export class VerovioToolkit {
    constructor(module: unknown);
    loadData(data: string): boolean;
    setOptions(options: Record<string, unknown>): void;
    renderToSVG(page?: number, xmlDeclaration?: boolean): string;
    renderToTimemap(options?: Record<string, unknown>): Array<{
      tstamp: number;
      qstamp: number;
      on?: string[];
      off?: string[];
      measureOn?: string;
    }>;
    getPageCount(): number;
    getPageWithElement(id: string): number;
    getElementsAtTime(ms: number): { page: number; notes: string[]; measure?: string };
    getLog(): string;
    getVersion(): string;
    redoLayout(options?: Record<string, unknown>): void;
  }
}
