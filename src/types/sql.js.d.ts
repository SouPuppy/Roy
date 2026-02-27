declare module "sql.js" {
  function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<{
    Database: new (data?: Uint8Array) => {
      run(sql: string): void;
      exec(sql: string): unknown;
      export(): Uint8Array;
      close(): void;
    };
  }>;
  export default initSqlJs;
}
