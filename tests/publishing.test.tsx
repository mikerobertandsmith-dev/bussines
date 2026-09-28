import { describe, expect, it } from "vitest";
import { buildAlerts } from "../src/lib/alerts";
import { sampleWorkspace } from "../src/data/sample";
import { isTerminalJob, jobStatusOf, platformLabelOf } from "../supabase/functions/_shared/mallary";

describe("Mallary helpers", () => {
  it("maps the provider's job states onto ours", () => {
    expect(jobStatusOf("queued")).toBe("queued");
    expect(jobStatusOf("processing")).toBe("publishing");
    expect(jobStatusOf("completed")).toBe("published");
    expect(jobStatusOf("failed")).toBe("failed");
    expect(jobStatusOf("cancelled")).toBe("failed");
    // Anything unrecognised is treated as still in flight, never as done.
    expect(jobStatusOf("weird")).toBe("queued");
  });

  it("only treats published and failed as terminal", () => {
    expect(isTerminalJob("completed")).toBe(true);
    expect(isTerminalJob("failed")).toBe(true);
    expect(isTerminalJob("queued")).toBe(false);
    expect(isTerminalJob("processing")).toBe(false);
  });

  it("labels known platforms and passes unknown ones through", () => {
    expect(platformLabelOf("instagram")).toBe("Instagram");
    expect(platformLabelOf("twitter")).toBe("X");
    expect(platformLabelOf("mastodon")).toBe("mastodon");
  });
});

describe("publishing alerts", () => {
  it("raises a failure alert and a published alert from the sample jobs", () => {
    const titles = buildAlerts(sampleWorkspace()).map((alert) => alert.title);

    expect(titles).toContain("Ad post failed");
    expect(titles).toContain("Ad published to Instagram, Facebook");
  });

  it("does not raise a published alert for an old post", () => {
    const data = sampleWorkspace();
    data.publishJobs = data.publishJobs.map((job) => ({
      ...job,
      status: "published" as const,
      updatedAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      error: "",
    }));

    const titles = buildAlerts(data).map((alert) => alert.title);
    expect(titles).not.toContain("Ad published to Instagram, Facebook");
  });
});
