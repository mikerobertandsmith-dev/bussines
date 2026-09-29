/**
 * An in-memory stand-in for the service-role Postgres client.
 *
 * Two gateway tests drive their **real** handlers with only the boundaries the
 * handler cannot run without substituted, and Postgres is one of them. The fake
 * answers the subset of the PostgREST builder the functions actually use, and it
 * answers it with Postgres' own semantics where those semantics are load-bearing:
 *
 *   - an awaited `select` resolves to an **array**, `single()`/`maybeSingle()` to
 *     one row (or null), because the difference decides whether a caller reads
 *     `.length` or `.id`;
 *   - `delete()` removes what its filters matched, so a prune that forgot its
 *     `.eq("business_id", …)` would delete another tenant's rows in the test too;
 *   - `upsert(rows, { onConflict })` merges on those columns, which is what makes
 *     "one row per competitor" true rather than hoped for.
 *
 * What it deliberately does **not** fake is row-level security. A handler runs as
 * the service role, so RLS is not in the path — the tenant guard these functions
 * rely on is the explicit `.eq("business_id", …)` in the query, and that is
 * exactly what a fake that honoured every filter is good at catching.
 *
 * `tests/helpers/contactsGateway.ts` carries an earlier, contacts-specific copy of
 * this builder. New handler tests should use this one.
 */

export type Row = Record<string, any>;

/** Any set of tables; a caller may declare its own narrower shape. */
export type Tables = { [table: string]: Row[] };

/** Postgres' unique-violation code, for a fake that enforces a real index. */
export const UNIQUE_VIOLATION = {
  code: "23505",
  message: "duplicate key value violates unique constraint",
};

/** Filters are closures so each operator stays a one-liner. */
type Filter = (row: Row) => boolean;

/**
 * Called before a write lands. Returning an error rejects the write, which is how
 * a caller models the partial unique indexes a migration really created.
 */
export type WriteGuard = (table: string, row: Row) => { code: string; message: string } | null;

export function nowIso(): string {
  return new Date().toISOString();
}

/** A builder that answers the subset of the PostgREST chain the gateways use. */
export class FakeQuery {
  private filters: Filter[] = [];
  private action: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private ordered: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private wantCount = false;
  private wantHead = false;
  private wantSingle = false;
  private conflictColumns: string[] = [];

  constructor(
    private db: Tables,
    private table: string,
    private guard: WriteGuard = () => null,
  ) {}

  select(_columns?: unknown, options?: { count?: string; head?: boolean }): this {
    if (options?.count) this.wantCount = true;
    if (options?.head) this.wantHead = true;
    return this;
  }

  insert(row: Row | Row[]): this {
    this.action = "insert";
    this.payload = row;
    return this;
  }

  /**
   * `onConflict` names the columns the row is identified by. The merge keeps the
   * existing row's identity and replaces its columns, which is what an upsert
   * against a real unique index does.
   */
  upsert(row: Row | Row[], options?: { onConflict?: string }): this {
    this.action = "insert";
    this.payload = row;
    this.conflictColumns = (options?.onConflict ?? "").split(",").map((c) => c.trim()).filter(Boolean);
    return this;
  }

  update(row: Row): this {
    this.action = "update";
    this.payload = row;
    return this;
  }

  delete(): this {
    this.action = "delete";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  gte(column: string, value: string): this {
    this.filters.push((row) => String(row[column] ?? "") >= value);
    return this;
  }

  lt(column: string, value: string): this {
    this.filters.push((row) => String(row[column] ?? "") < value);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.ordered = { column, ascending: options?.ascending !== false };
    return this;
  }

  limit(count: number): this {
    this.limitN = count;
    return this;
  }

  /** The non-nullable read: one row, and an error when there is none. */
  single(): Promise<{ data: any; error: any; count: number | null }> {
    this.wantSingle = true;
    return this.run();
  }

  /** The nullable read: one row or none, never an error for absence. */
  maybeSingle(): Promise<{ data: any; error: any; count: number | null }> {
    this.wantSingle = true;
    return this.run();
  }

  /** Awaiting the builder directly — a list read, a count, or any write. */
  then(resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown) {
    return this.run().then(resolve, reject);
  }

  private rows(): Row[] {
    const table = (this.db as Tables)[this.table] ?? [];
    return table.filter((row) => this.filters.every((filter) => filter(row)));
  }

  /** The table, created on first write so a test need only seed what it reads. */
  private store(): Row[] {
    const tables = this.db as Tables;
    if (!tables[this.table]) tables[this.table] = [];
    return tables[this.table];
  }

  private resolveConflict(row: Row): Row | null {
    if (!this.conflictColumns.length) return null;
    if (this.conflictColumns.some((column) => row[column] === undefined)) return null;
    return (
      this.store().find((existing) =>
        this.conflictColumns.every((column) => existing[column] === row[column]),
      ) ?? null
    );
  }

  private async run(): Promise<{ data: any; error: any; count: number | null }> {
    if (this.action === "insert") {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      const saved: Row[] = [];

      for (const raw of incoming) {
        const conflict = this.resolveConflict(raw);
        const row = conflict
          ? Object.assign(conflict, raw)
          : { id: crypto.randomUUID(), created_at: nowIso(), updated_at: nowIso(), ...raw };

        const violation = this.guard(this.table, row);
        if (violation) return { data: null, error: violation, count: null };

        if (!conflict) this.store().push(row);
        saved.push(row);
      }

      return { data: Array.isArray(this.payload) ? saved : (saved[0] ?? null), error: null, count: null };
    }

    if (this.action === "update") {
      const matched = this.rows();
      for (const row of matched) Object.assign(row, this.payload);
      // A single-row update answers with the row, which is how a caller that
      // writes-then-reads the result in one call expects it.
      return { data: this.wantSingle ? (matched[0] ?? null) : null, error: null, count: null };
    }

    if (this.action === "delete") {
      const doomed = new Set(this.rows());
      const tables = this.db as Tables;
      tables[this.table] = this.store().filter((row) => !doomed.has(row));
      return { data: null, error: null, count: null };
    }

    let matched = this.rows();
    if (this.ordered) {
      const { column, ascending } = this.ordered;
      matched = [...matched].sort((a, b) =>
        ascending
          ? String(a[column] ?? "").localeCompare(String(b[column] ?? ""))
          : String(b[column] ?? "").localeCompare(String(a[column] ?? "")),
      );
    }
    if (this.limitN !== null) matched = matched.slice(0, this.limitN);

    // `head: true` asks for the count only, which is how a monthly allowance is
    // read — an implementation that also returned rows would silently make that
    // cap useless.
    const data = this.wantHead ? null : this.wantSingle ? (matched[0] ?? null) : matched;
    return { data, error: null, count: this.wantCount ? matched.length : null };
  }
}

/** The service-role client, as far as a handler is concerned. */
export function adminClientFor(tables: Tables, guard?: WriteGuard) {
  return {
    from: (table: string) => new FakeQuery(tables, table, guard),
  };
}

/** A `fetch` response shaped like the ones the shared clients expect. */
export function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}
