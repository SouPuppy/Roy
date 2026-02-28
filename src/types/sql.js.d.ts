declare module "sql.js" {
  type Statement = {
    bind(values: unknown[]): void;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  };

  type Database = {
    run(sql: string, params?: unknown[]): void;
    exec(sql: string): unknown;
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  };

  function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<{
    Database: new (data?: Uint8Array) => Database;
  }>;
  export default initSqlJs;
}
