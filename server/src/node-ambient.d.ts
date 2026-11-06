declare var __dirname: string;
declare var __filename: string;
declare var require: {
  (id: string): any;
  main?: any;
};
declare var module: {
  exports: any;
};
declare var process: {
  env: Record<string, string | undefined>;
  cwd(): string;
  exit(code?: number): never;
  argv: string[];
};

interface Buffer {
  length: number;
  toString(encoding?: string): string;
}
declare var Buffer: {
  from(data: any, encoding?: string): Buffer;
  concat(list: Buffer[], totalLength?: number): Buffer;
};

declare module 'http' {
  export interface IncomingMessage {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    on(event: 'data', listener: (chunk: Buffer) => void): this;
    on(event: 'end', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    destroy(): void;
  }
  export interface ServerResponse {
    writeHead(statusCode: number, headers?: Record<string, string>): this;
    end(data?: string | Buffer): void;
  }
  export interface Server {
    listen(port: number, hostname?: string, listeningListener?: () => void): this;
    listen(port: number, listeningListener?: () => void): this;
    close(callback?: (err?: Error) => void): this;
    address(): { port: number; address: string; family: string } | string | null;
  }
  export function createServer(
    requestListener?: (req: IncomingMessage, res: ServerResponse) => void
  ): Server;
  const httpDefault: {
    createServer: typeof createServer;
  };
  export default httpDefault;
}

declare module 'fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: string): string;
  export function statSync(path: string): { isDirectory(): boolean; isFile(): boolean };
  export function createReadStream(path: string): { pipe(dest: any): any };
  const fsDefault: {
    existsSync: typeof existsSync;
    readFileSync: typeof readFileSync;
    statSync: typeof statSync;
    createReadStream: typeof createReadStream;
  };
  export default fsDefault;
}

declare module 'path' {
  export function resolve(...paths: string[]): string;
  export function join(...paths: string[]): string;
  export function normalize(p: string): string;
  export function extname(p: string): string;
  const pathDefault: {
    resolve: typeof resolve;
    join: typeof join;
    normalize: typeof normalize;
    extname: typeof extname;
  };
  export default pathDefault;
}
