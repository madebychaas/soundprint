/**
 * A better-sqlite3-compatible façade over Node's built-in `node:sqlite`.
 *
 * Why this exists
 * ---------------
 * Soundprint originally used the `better-sqlite3` native addon. Under
 * `next dev` it crashed the server process during garbage collection:
 *
 *     node::RemoveEnvironmentCleanupHook ... Assertion failed: (env) != nullptr
 *     Statement::~Statement() [better_sqlite3.node]
 *
 * The addon's Statement finaliser runs when no V8 context is entered — which
 * happens once Next.js's dev server tears down and rebuilds module contexts on
 * hot reload — and asserts. It is not something the application layer can guard
 * against, because the crash happens inside GC rather than on any call path we
 * control.
 *
 * Node 24 ships SQLite in core, so the native addon is unnecessary. That
 * removes the crash class outright and drops a compiled dependency, which also
 * makes install faster and more reliable.
 *
 * Drizzle's better-sqlite3 driver touches a small, stable surface —
 * `prepare`, `transaction`, and `run`/`all`/`get`/`raw` on statements — so
 * adapting is a thin shim rather than a reimplementation. Everything below
 * mirrors better-sqlite3's documented semantics, including `raw()` mutating the
 * statement and returning it for chaining.
 */

import { createRequire } from "node:module";

/**
 * `node:sqlite` is loaded through createRequire rather than a static import.
 *
 * Bundlers keep a hard-coded list of Node builtins, and `node:sqlite` is newer
 * than the list Vite ships. A static `import "node:sqlite"` gets its prefix
 * stripped and Vite then tries to resolve a package literally named "sqlite"
 * from node_modules, which fails under Vitest. Next.js resolves it correctly,
 * so this only affects tests — but an untestable database layer is not
 * acceptable, and createRequire is the standard escape hatch: it defers
 * resolution to Node, which has the module.
 */
const nodeRequire = createRequire(import.meta.url);

interface StatementSync {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  setReturnArrays(enabled: boolean): void;
}

interface DatabaseSyncCtor {
  new (path: string): {
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    close(): void;
  };
}

const { DatabaseSync } = nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
type DatabaseSync = InstanceType<DatabaseSyncCtor>;

type Params = unknown[];

export interface CompatStatement {
  run(...params: Params): { changes: number | bigint; lastInsertRowid: number | bigint };
  all(...params: Params): unknown[];
  get(...params: Params): unknown;
  values(...params: Params): unknown[];
  /** Mutates the statement to return arrays, then returns itself (better-sqlite3 semantics). */
  raw(toggle?: boolean): CompatStatement;
}

/**
 * node:sqlite rejects `undefined` as a bound parameter, while drizzle can emit
 * it for an omitted optional column. Normalising to null matches what
 * better-sqlite3 users expect from drizzle and keeps inserts working.
 */
function normalise(params: Params): Params {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === "boolean") return p ? 1 : 0;
    return p;
  });
}

function wrapStatement(stmt: StatementSync): CompatStatement {
  let returnsArrays = false;

  const self: CompatStatement = {
    run(...params: Params) {
      return stmt.run(...(normalise(params) as never[]));
    },
    all(...params: Params) {
      return stmt.all(...(normalise(params) as never[])) as unknown[];
    },
    get(...params: Params) {
      return stmt.get(...(normalise(params) as never[]));
    },
    values(...params: Params) {
      stmt.setReturnArrays(true);
      returnsArrays = true;
      return stmt.all(...(normalise(params) as never[])) as unknown[];
    },
    raw(toggle = true) {
      stmt.setReturnArrays(toggle);
      returnsArrays = toggle;
      return self;
    },
  };

  void returnsArrays; // retained for clarity about the statement's mode
  return self;
}

export class NodeSqliteCompat {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
  }

  prepare(sql: string): CompatStatement {
    return wrapStatement(this.#db.prepare(sql));
  }

  exec(sql: string): void {
    this.#db.exec(sql);
  }

  /**
   * better-sqlite3 exposes pragmas as a method; node:sqlite does not.
   * Implemented via exec/prepare so call sites stay unchanged.
   */
  pragma(statement: string): unknown {
    const trimmed = statement.trim();
    if (trimmed.includes("=")) {
      this.#db.exec(`PRAGMA ${trimmed}`);
      return undefined;
    }
    return this.#db.prepare(`PRAGMA ${trimmed}`).all();
  }

  /**
   * Synchronous transaction wrapper matching better-sqlite3's shape: calling
   * `db.transaction(fn)` returns a function that runs `fn` inside BEGIN/COMMIT
   * and rolls back if it throws.
   */
  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    const runner = (...args: never[]) => {
      this.#db.exec("BEGIN");
      try {
        const result = fn(...args);
        this.#db.exec("COMMIT");
        return result;
      } catch (err) {
        try {
          this.#db.exec("ROLLBACK");
        } catch {
          /* the transaction may already have been rolled back by SQLite */
        }
        throw err;
      }
    };
    return runner as unknown as T;
  }

  close(): void {
    this.#db.close();
  }
}
