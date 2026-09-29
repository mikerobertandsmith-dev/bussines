import { describe, expect, it } from "vitest";
import { localResultsOf, organicResultsOf } from "../supabase/functions/_shared/serpapi";

/**
 * The provider's response *shape* is not stable across engines and device modes,
 * and one of those shapes used to take an entire scan down: the Google engine in
 * mobile device mode answers `local_results` with the expanded "more places" block
 * — an object, not an array — so `.slice` threw and `serp-scan` aborted before it
 * had persisted a single ranking, on every default run.
 *
 * These are the shapes observed against the live API, pinned here so a future
 * change has to be deliberate.
 */
describe("SerpApi response normalisation", () => {
  it("passes an array of local results straight through", () => {
    const rows = [{ title: "A" }, { title: "B" }];
    expect(localResultsOf({ local_results: rows })).toEqual(rows);
  });

  it("unwraps the `places` block the mobile Google engine answers with", () => {
    const places = [{ title: "A" }, { title: "B" }, { title: "C" }];
    const response = { local_results: { places, more_locations_link: "https://example.test" } };
    expect(localResultsOf(response)).toEqual(places);
  });

  it("reads a result object keyed by index", () => {
    const response = { local_results: { "0": { title: "A" }, "1": { title: "B" } } };
    expect(localResultsOf(response).map((entry) => entry.title)).toEqual(["A", "B"]);
  });

  it("answers an empty list when the engine omits the key entirely", () => {
    // The desktop Google engine does exactly this, and it is the common case.
    expect(localResultsOf({})).toEqual([]);
    expect(localResultsOf({ local_results: null })).toEqual([]);
  });

  it("never hands anything but an array back for the organic results", () => {
    const rows = [{ title: "A" }];
    expect(organicResultsOf({ organic_results: rows })).toEqual(rows);
    // A shape we do not recognise degrades to "nothing found" rather than throwing
    // inside a scan loop.
    expect(organicResultsOf({ organic_results: { places: rows } })).toEqual([]);
    expect(organicResultsOf({})).toEqual([]);
  });
});
