import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useWorkspace } from "./workspace";

/**
 * How long a pull-to-refresh stays satisfied.
 *
 * One pull runs three workspace-wide scans **and** one catalogue read per watched
 * source, every one of them billed, so the cap is what keeps an idle drag from
 * re-running the whole sweep: inside the hour the gesture reports the workspace as
 * current instead of calling any provider.
 */
export const PULL_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

/** Stored, so refreshing the browser tab does not hand back a free sweep. */
const STORAGE_KEY = "workspace:pull-refresh-at";

/** How one batch of scans ended, of those attempted. */
export interface ScanTally {
  /** Scans that answered with a result. */
  ran: number;
  /** Scans the pull asked for. */
  attempted: number;
}

/** What one pull did, so the caller can word its own report. */
export type PullOutcome =
  | {
      status: "refreshed";
      /** The workspace-wide scans (search, social, benchmark). */
      live: ScanTally;
      /** The per-source catalogue reads on the supplier and competitor pages. */
      site: ScanTally;
      /** Catalogue crawls still working; the next pull collects them. */
      running: number;
      /** Calls that refused or errored. */
      failed: number;
    }
  | { status: "capped"; lastRefreshedAt: string }
  | { status: "busy" };

/**
 * How a batch of settled scan promises ended.
 *
 * A fulfilled promise is not the same as a scan that ran. `site-scan` answers 200
 * with `status: "running"` when a crawl outlives our wait — it is collected on the
 * next pull, and the money is already spent — and with `status: "unavailable"`
 * when this deployment has no actor id for that target. Counting either as "ran"
 * would report work that never happened.
 */
function tally(results: PromiseSettledResult<unknown>[]): {
  ran: number;
  running: number;
  failed: number;
} {
  let ran = 0;
  let running = 0;
  let failed = 0;

  for (const result of results) {
    if (result.status === "rejected") {
      failed += 1;
      continue;
    }
    const status =
      result.value && typeof result.value === "object"
        ? String((result.value as { status?: unknown }).status ?? "")
        : "";
    if (status === "running") running += 1;
    else if (status === "unavailable") continue;
    else ran += 1;
  }

  return { ran, running, failed };
}

interface RefreshContextValue {
  /** A pull is queueing scans and re-reading the workspace right now. */
  refreshing: boolean;
  /** When the last pull ran, or null before the first one. */
  lastRefreshedAt: string | null;
  pull: () => Promise<PullOutcome>;
}

const RefreshContext = createContext<RefreshContextValue | null>(null);

export function useRefresh(): RefreshContextValue {
  const ctx = useContext(RefreshContext);
  if (!ctx) throw new Error("useRefresh must be used inside a RefreshProvider");
  return ctx;
}

/** Reads the stored pull time, tolerating a blocked or absent localStorage. */
function readStoredPull(): string | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw && Number.isFinite(Date.parse(raw)) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * One refresh for the whole workspace, shared by every page that pulls.
 *
 * Suppliers, Competition and My Business read the same workspace, so they are
 * refreshed by the same call: there is no per-page reload to drift out of sync,
 * and a pull on any of them leaves the other two already current.
 */
export function RefreshProvider({ children }: { children: ReactNode }) {
  const { data, actions, refresh } = useWorkspace();
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(readStoredPull);
  const [refreshing, setRefreshing] = useState(false);
  // A ref rather than the state: two releases in the same tick would both read a
  // stale `refreshing` and run the entire sweep twice.
  const running = useRef(false);

  const pull = useCallback(async (): Promise<PullOutcome> => {
    if (running.current) return { status: "busy" };

    if (lastRefreshedAt && Date.now() - Date.parse(lastRefreshedAt) < PULL_REFRESH_INTERVAL_MS) {
      return { status: "capped", lastRefreshedAt };
    }

    running.current = true;
    setRefreshing(true);
    try {
      // Scans first, because re-reading on its own can only show what the last
      // scan produced. The three live scans are workspace-wide (search, social and
      // the competitor benchmark); the site reads are one per watched source, and
      // both halves really call a provider now.
      const live = [
        actions.runSerpScan(),
        actions.runSocialScan(),
        actions.runCompetitorBenchmark(),
      ];
      // One read per supplier and competitor, in parallel. Each is bounded by the
      // same per-run page and dollar caps, and the pull re-reads the workspace once
      // at the end rather than after every one of them.
      const site = [
        ...(data?.suppliers ?? []).map((supplier) => actions.scanSupplierSite(supplier.id)),
        ...(data?.competitors ?? []).map((competitor) => actions.scanCompetitorSite(competitor.id)),
      ];

      const [liveSettled, siteSettled] = await Promise.all([
        Promise.allSettled(live),
        Promise.allSettled(site),
      ]);
      const liveOutcome = tally(liveSettled);
      const siteOutcome = tally(siteSettled);

      // Stamped before the re-read, and on purpose: the provider spend has already
      // happened by now, so a reload that then fails must not hand the user a free
      // retry that bills every source a second time.
      const at = new Date().toISOString();
      setLastRefreshedAt(at);
      try {
        window.localStorage.setItem(STORAGE_KEY, at);
      } catch {
        // A blocked localStorage only costs the cap its persistence.
      }

      // Silent, so the pages keep the version on screen while this lands — and it
      // is what actually puts the scans' writes on screen.
      await refresh({ silent: true });
      return {
        status: "refreshed",
        live: { ran: liveOutcome.ran, attempted: live.length },
        site: { ran: siteOutcome.ran, attempted: site.length },
        running: siteOutcome.running,
        failed: liveOutcome.failed + siteOutcome.failed,
      };
    } finally {
      running.current = false;
      setRefreshing(false);
    }
  }, [actions, data, lastRefreshedAt, refresh]);

  const value = useMemo<RefreshContextValue>(
    () => ({ refreshing, lastRefreshedAt, pull }),
    [refreshing, lastRefreshedAt, pull],
  );

  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>;
}
