import { vi } from "vitest";
import { HttpError } from "../../supabase/functions/_shared/errors.ts";

/**
 * The two boundaries `web-contacts-scan` cannot be run without, faked so the
 * real handler can be exercised in a test.
 *
 * Everything *above* these is the shipped code: the handler itself, the real
 * Apify client (`_shared/apify.ts` — run start, polling, dataset fetch), the
 * real normaliser, the real cap readers and the real `recordUsage`. Only three
 * things are substituted:
 *
 *   1. **Clerk.** `requireCaller` normally verifies a JWT against Clerk's JWKS,
 *      which needs a network and a real session. Verifying Clerk is not our code
 *      and not what these tests are about, so the identity is injected instead.
 *   2. **Postgres.** The service-role client is replaced by an in-memory store
 *      that answers the same builder chain. Crucially it also implements the two
 *      partial unique indexes from migration `0020`, because the one-live-run
 *      claim is *supposed* to be enforced by the database — a fake that skipped
 *      that would let a broken claim pass.
 *   3. **Apify's HTTP API.** Left real as a client and faked at `fetch`, so the
 *      request shapes, the dataset read and the cost arithmetic are the shipped
 *      ones.
 */

/* ----------------------------------------------------------------- storage */

export type Row = Record<string, any>;

export interface FakeDb {
  businesses: Row[];
  competitors: Row[];
  contacts_discovery_runs: Row[];
  api_usage_log: Row[];
}

export function emptyDb(): FakeDb {
  return { businesses: [], competitors: [], contacts_discovery_runs: [], api_usage_log: [] };
}

/** Filters are closures so each operator stays a one-liner. */
type Filter = (row: Row) => boolean;

/**
 * Postgres' unique-violation code. The fake raises it for the same two cases the
 * migration does, so a test can race two real requests and watch one lose.
 */
const UNIQUE_VIOLATION = { code: "23505", message: "duplicate key value violates unique constraint" };

function violatesUniqueKey(db: FakeDb, table: string, row: Row): boolean {
  if (table !== "contacts_discovery_runs") return false;
  const rows = db.contacts_discovery_runs;

  // `contacts_discovery_runs_run_id_idx` — a run is recorded exactly once.
  if (row.run_id) {
    if (rows.some((existing) => existing.run_id === row.run_id)) return true;
  }

  // `contacts_discovery_runs_one_live_idx` — one live stored run per competitor.
  if (row.mode === "stored" && row.status === "running" && row.competitor_id) {
    const live = rows.some(
      (existing) =>
        existing.mode === "stored" &&
        existing.status === "running" &&
        existing.competitor_id === row.competitor_id,
    );
    if (live) return true;
  }

  return false;
}

/** A builder that answers the subset of the PostgREST chain the handler uses. */
class FakeQuery {
  private filters: Filter[] = [];
  private action: "select" | "insert" | "update" = "select";
  private payload: Row | null = null;
  private ordered: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private wantCount = false;
  private wantHead = false;

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select(_columns?: unknown, options?: { count?: string; head?: boolean }): this {
    if (options?.count) this.wantCount = true;
    if (options?.head) this.wantHead = true;
    return this;
  }

  insert(row: Row): this {
    this.action = "insert";
    this.payload = row;
    return this;
  }

  update(row: Row): this {
    this.action = "update";
    this.payload = row;
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

  /** `.single()` is the non-nullable read; `maybeSingle()` tolerates no rows. */
  single() {
    return this.run();
  }

  maybeSingle() {
    return this.run();
  }

  /** Awaiting the builder directly — the count query and every write do this. */
  then(resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown) {
    return this.run().then(resolve, reject);
  }

  private rows(): Row[] {
    const table = (this.db as unknown as Record<string, Row[]>)[this.table] ?? [];
    return table.filter((row) => this.filters.every((filter) => filter(row)));
  }

  private async run(): Promise<{ data: any; error: any; count: number | null }> {
    const store = this.db as unknown as Record<string, Row[]>;

    if (this.action === "insert") {
      const row = { id: crypto.randomUUID(), created_at: nowIso(), updated_at: nowIso(), ...this.payload };
      if (violatesUniqueKey(this.db, this.table, row)) {
        return { data: null, error: UNIQUE_VIOLATION, count: null };
      }
      store[this.table].push(row);
      return { data: row, error: null, count: null };
    }

    if (this.action === "update") {
      for (const row of this.rows()) Object.assign(row, this.payload);
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

    // `head: true` asks for the count only, which is how the per-user allowance
    // is read — and an implementation that also returned rows would silently
    // make that cap useless.
    return {
      data: this.wantHead ? null : (matched[0] ?? null),
      error: null,
      count: this.wantCount ? matched.length : null,
    };
  }
}

function nowIso() {
  return new Date().toISOString();
}

/* ------------------------------------------------------------- injected state */

export const state: {
  userId: string;
  db: FakeDb;
} = { userId: "user-a", db: emptyDb() };

/** The service-role client, as far as the handler is concerned. */
export function adminClient() {
  return {
    from: (table: string) => new FakeQuery(state.db, table),
  };
}

/** The Clerk check, replaced by an identity the test sets. */
export async function requireCaller() {
  if (!state.userId) throw new HttpError(401, "Missing bearer token.");
  return { userId: state.userId };
}

/** Kept real: tenant ownership is a security boundary worth exercising. */
export async function assertBusinessOwned(callerUserId: string, businessId: string) {
  const business = state.db.businesses.find((row) => row.id === businessId);
  if (!business || business.owner_user_id !== callerUserId) {
    throw new HttpError(403, "You do not have access to this business.");
  }
  return business;
}

/* ------------------------------------------------------------------- apify */

export interface ApifyFake {
  /** Every request the client made, for asserting "no second run was bought". */
  calls: string[];
  /** Run id → the status `/actor-runs/{id}` should report. */
  statuses: Map<string, string>;
  /** Run ids `/actor-runs/{id}` should answer 404 for — an expired run. */
  gone: Set<string>;
  /** Run ids `/actor-runs/{id}` should answer 500 for — a transient failure. */
  broken: Set<string>;
  /** What a started run costs, in dollars. */
  costUsd: number;
  /** Dataset items returned by `/datasets/{id}/items`. */
  items: Row[];
  /** How many runs were actually started. */
  starts: number;
}

/**
 * The Apify API, as the client sees it.
 *
 * A started run comes back already `SUCCEEDED`, so the handler's wait loop is
 * never reached — a deliberate choice, since the alternative is a test that
 * spins against a real 60-second deadline.
 */
export function fakeApify(overrides: Partial<ApifyFake> = {}): ApifyFake {
  const fake: ApifyFake = {
    calls: [],
    statuses: new Map(),
    gone: new Set(),
    broken: new Set(),
    costUsd: 0.0123,
    items: [],
    starts: 0,
    ...overrides,
  };

  let seq = 0;
  vi.stubGlobal("fetch", async (input: unknown, init?: { method?: string }) => {
    const url = new URL(String(input));
    fake.calls.push(`${init?.method ?? "GET"} ${url.pathname}`);

    if (url.pathname.includes("/datasets/")) {
      return jsonResponse(fake.items);
    }

    if (url.pathname.includes("/actors/") && url.pathname.endsWith("/runs")) {
      fake.starts += 1;
      const id = `run-${++seq}`;
      fake.statuses.set(id, "SUCCEEDED");
      return jsonResponse({ data: runBody(id, fake) });
    }

    const runId = url.pathname.split("/").pop() ?? "";
    if (fake.gone.has(runId)) return jsonResponse({ error: { message: "not found" } }, 404);
    if (fake.broken.has(runId)) return jsonResponse({ error: { message: "boom" } }, 500);
    return jsonResponse({ data: runBody(runId, fake) });
  });

  return fake;
}

function runBody(id: string, fake: ApifyFake) {
  return {
    id,
    status: fake.statuses.get(id) ?? "SUCCEEDED",
    defaultDatasetId: `dataset-for-${id}`,
    usageTotalUsd: fake.costUsd,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/* ------------------------------------------------------------ conveniences */

export function seedCompetitor(overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: "comp-1",
    business_id: "biz-1",
    name: "GlowMart Beauty",
    website: "https://glowmartbeauty.com",
    contacts_status: "idle",
    contacts_run_id: "",
    ...overrides,
  };
  state.db.competitors.push(row);
  return row;
}

export function seedBusiness(id = "biz-1", owner = "user-a"): Row {
  const row = { id, owner_user_id: owner, name: "GlowHouse" };
  state.db.businesses.push(row);
  return row;
}

/** A finished ledger row, with the timestamps controlled by the caller. */
export function seedFinishedRun(overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: crypto.randomUUID(),
    user_id: "user-a",
    business_id: "biz-1",
    competitor_id: "comp-1",
    mode: "stored",
    run_id: `run-seed-${state.db.contacts_discovery_runs.length}`,
    actor_id: "9Sk4JJhEma9vBKqrg",
    scanned_url: "https://glowmartbeauty.com",
    status: "done",
    suggestions: [],
    unmonitored: [],
    suggestion_count: 0,
    cost_usd: 0.01,
    error: null,
    created_at: nowIso(),
    updated_at: nowIso(),
    ...overrides,
  };
  state.db.contacts_discovery_runs.push(row);
  return row;
}

export function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}
