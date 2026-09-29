/**
 * What the last catalogue read of a watched source actually did.
 *
 * The Suppliers page had one number to show for a read — how many *changes* came
 * back — and every supplier it watches publishes no readable catalogue, so that
 * number was always 0 and the page looked like nothing was running. Two different
 * facts were being rendered identically:
 *
 *   - "we read their site and it publishes no product catalogue", which is a
 *     finding, and
 *   - "we have never managed to read their site", which is a fault.
 *
 * `site_scan_at` is set on every read that settled, success or failure, while
 * `last_scan_at` moves only on a read that produced something — so the two
 * together, plus the item count and any recorded error, are enough to tell the
 * states apart without asking a provider anything.
 */

/** How a source's last catalogue read turned out. */
export type SourceReadState = "pending" | "failed" | "unread" | "no-catalogue" | "listed";

export interface ReadSignals {
  /** A crawl has been paid for and not yet read back (`site_run_id` is set). */
  siteScanPending?: boolean;
  /** Why the last read failed, as recorded by `site-scan`. */
  siteError?: string;
  /** When the last read settled — set even when it produced nothing. */
  siteScanAt?: string;
  /** How many items we hold from this source, i.e. how many changes it ever made. */
  itemCount: number;
}

/**
 * The state, most specific first.
 *
 * `pending` outranks `failed` deliberately: a run in flight has no outcome yet, and
 * an error left over from an earlier attempt would otherwise be reported as what is
 * happening now.
 */
export function readStateOf(signals: ReadSignals): SourceReadState {
  if (signals.siteScanPending) return "pending";
  if (signals.siteError) return "failed";
  // Holding items *is* evidence of a read that worked, and it outranks the missing
  // timestamp: rows cannot exist without one having happened. Checking the timestamp
  // first would report a source we hold a catalogue for as "not read yet" on any row
  // whose `site_scan_at` predates the column's introduction.
  if (signals.itemCount > 0) return "listed";
  if (!signals.siteScanAt) return "unread";
  // A read that settled cleanly and wrote no rows. For the garment factories this
  // app watches that is the correct, permanent answer: a factory site with no
  // shopfront has no catalogue to publish.
  return "no-catalogue";
}

/** A badge tone for a state, from the set the Badge component renders. */
export function readStateTone(
  state: SourceReadState,
): "good" | "warn" | "bad" | "neutral" | "brand" {
  switch (state) {
    case "listed":
      return "good";
    case "pending":
      return "brand";
    case "failed":
      return "bad";
    case "no-catalogue":
      return "neutral";
    default:
      return "warn";
  }
}

/** The badge text, and the sentence that explains it. */
export function readStateCopy(
  state: SourceReadState,
  signals: ReadSignals,
): { label: string; detail: string } {
  switch (state) {
    case "pending":
      return {
        label: "reading",
        detail: "A catalogue crawl is running; its result is collected on the next refresh.",
      };
    case "failed":
      return {
        label: "read failed",
        detail: signals.siteError || "The last catalogue read did not finish cleanly.",
      };
    case "unread":
      return {
        label: "not read yet",
        detail: "No catalogue read has settled for this supplier, so nothing is known about it.",
      };
    case "listed":
      return {
        label: "listing products",
        detail: `${signals.itemCount} product change${signals.itemCount === 1 ? "" : "s"} read from this site.`,
      };
    default:
      return {
        label: "no catalogue",
        detail:
          "Read cleanly — the site publishes no product catalogue to monitor. A factory that sells through agents or a marketplace usually has none.",
      };
  }
}

/**
 * One sentence describing the whole watched set, for the page to lead with.
 *
 * Written to be true for the common case here — every source read, none with a
 * catalogue — rather than the optimistic case, because the optimistic sentence is
 * the one that made an empty table look like a broken scan.
 */
export function readSetSummary(states: SourceReadState[]): string {
  if (!states.length) return "No supplier sites are being watched yet.";
  const counted = (state: SourceReadState) => states.filter((value) => value === state).length;

  const parts: string[] = [];
  const listed = counted("listed");
  const empty = counted("no-catalogue");
  const failed = counted("failed");
  const pending = counted("pending");
  const unread = counted("unread");

  if (listed) parts.push(`${listed} publishing a product catalogue`);
  if (empty) parts.push(`${empty} with no catalogue to read`);
  if (pending) parts.push(`${pending} being read now`);
  if (unread) parts.push(`${unread} not read yet`);
  if (failed) parts.push(`${failed} whose last read failed`);

  return `${states.length} supplier site${states.length === 1 ? "" : "s"} checked — ${parts.join(", ")}.`;
}
