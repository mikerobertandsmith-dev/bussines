import { describe, expect, it } from "vitest";

import { readSetSummary, readStateCopy, readStateOf, readStateTone } from "../src/lib/reads";

/**
 * The states below are the ones this deployment's actual sources are in: the four
 * garment factories have each been read cleanly and published nothing, which is the
 * case that used to render identically to "we never read them".
 */
describe("readStateOf", () => {
  it("calls a source with no recorded attempt 'unread', not 'empty'", () => {
    expect(readStateOf({ itemCount: 0 })).toBe("unread");
  });

  it("distinguishes a clean read that published nothing from never reading", () => {
    // The whole point: `siteScanAt` is set on a settled read either way, so this
    // is a finding — the site has no catalogue — and not an absence of data.
    expect(readStateOf({ siteScanAt: "2026-09-29T08:15:00.000Z", itemCount: 0 })).toBe(
      "no-catalogue",
    );
    expect(readStateOf({ siteScanAt: "2026-09-29T08:15:00.000Z", itemCount: 3 })).toBe("listed");
  });

  it("reports an in-flight read as reading, ahead of an older error", () => {
    // A leftover error from a previous attempt must not be reported as what is
    // happening now.
    expect(
      readStateOf({
        siteScanPending: true,
        siteError: "The site read did not finish cleanly: TIMED-OUT",
        siteScanAt: "2026-09-28T00:00:00.000Z",
        itemCount: 0,
      }),
    ).toBe("pending");
  });

  it("reports a recorded failure as failed", () => {
    expect(
      readStateOf({ siteError: "The site read did not finish cleanly: ABORTED", itemCount: 0 }),
    ).toBe("failed");
  });
});

describe("readStateCopy", () => {
  it("explains the no-catalogue case as the site's answer, not a fault", () => {
    const copy = readStateCopy("no-catalogue", { itemCount: 0 });
    expect(copy.label).toBe("no catalogue");
    expect(copy.detail).toContain("Read cleanly");
    expect(copy.detail).toContain("no product catalogue");
  });

  it("counts items in the listing copy, singular and plural", () => {
    expect(readStateCopy("listed", { itemCount: 1 }).detail).toContain("1 product change");
    expect(readStateCopy("listed", { itemCount: 4 }).detail).toContain("4 product changes");
  });

  it("passes the recorded error through for a failed read", () => {
    expect(readStateCopy("failed", { itemCount: 0, siteError: "TIMED-OUT" }).detail).toBe(
      "TIMED-OUT",
    );
    // With nothing recorded, it still says something rather than an empty sentence.
    expect(readStateCopy("failed", { itemCount: 0 }).detail).toContain("did not finish cleanly");
  });

  it("gives every state a tone and a label", () => {
    for (const state of ["pending", "failed", "unread", "no-catalogue", "listed"] as const) {
      expect(readStateCopy(state, { itemCount: 0 }).label).toBeTruthy();
      expect(readStateTone(state)).toBeTruthy();
    }
  });
});

describe("readSetSummary", () => {
  it("leads with what the watched set actually is, not with an optimistic default", () => {
    expect(readSetSummary(["no-catalogue", "no-catalogue", "no-catalogue"])).toBe(
      "3 supplier sites checked — 3 with no catalogue to read.",
    );
  });

  it("names every state present, so a mixed set is not summarised as its best part", () => {
    const summary = readSetSummary(["listed", "no-catalogue", "failed", "pending", "unread"]);
    expect(summary).toContain("1 publishing a product catalogue");
    expect(summary).toContain("1 with no catalogue to read");
    expect(summary).toContain("1 being read now");
    expect(summary).toContain("1 not read yet");
    expect(summary).toContain("1 whose last read failed");
  });

  it("uses the singular for one site", () => {
    expect(readSetSummary(["listed"])).toContain("1 supplier site checked");
  });

  it("says so when nothing is watched", () => {
    expect(readSetSummary([])).toBe("No supplier sites are being watched yet.");
  });
});
