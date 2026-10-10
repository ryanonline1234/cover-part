declare module "verovio/wasm" {
  const createVerovioModule: () => Promise<unknown>;
  export default createVerovioModule;
}

declare module "verovio/esm" {
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
