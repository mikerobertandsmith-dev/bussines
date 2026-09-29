import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../src/App";
import { LandingPage } from "../src/pages/LandingPage";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  window.localStorage.clear();
  window.location.hash = "#/suppliers";
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function text() {
  return container.textContent ?? "";
}

function click(el: Element | null | undefined) {
  if (!el) throw new Error("element not found");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function typeInto(input: HTMLInputElement | null | undefined, value: string) {
  if (!input) throw new Error("input not found");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function findByText(selector: string, label: string) {
  return Array.from(container.querySelectorAll(selector)).find((el) =>
    (el.textContent ?? "").includes(label),
  );
}

/** Matches on the element's whole label, for tabs that share a word with the nav. */
function findByExactText(selector: string, label: string) {
  return Array.from(container.querySelectorAll(selector)).find(
    (el) => (el.textContent ?? "").trim() === label,
  );
}

function activeDialog() {
  const dialog = container.querySelector('[role="dialog"]');
  if (!dialog) throw new Error("no dialog is open");
  return dialog;
}

function dialogButton(label: string) {
  return Array.from(activeDialog().querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

/** The big number in a named `Stat` card, e.g. "Suppliers monitored". */
function statValue(label: string): number {
  const labelEl = Array.from(container.querySelectorAll("p")).find(
    (p) => (p.textContent ?? "").trim() === label,
  );
  const card = labelEl?.closest("section");
  return Number(card?.querySelector("p.text-2xl")?.textContent ?? "");
}

async function render() {
  await act(async () => {
    root.render(<App />);
  });
  return text();
}

/**
 * Drags the page down far enough and releases, which is how the three monitoring
 * pages refresh now that they carry no reload button of their own.
 */
function pullToRefresh() {
  const surface = container.querySelector('[aria-label^="Pull down to refresh"]');
  if (!surface) throw new Error("no pull-to-refresh surface on this page");
  act(() => {
    surface.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientY: 10 }));
    surface.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientY: 210 }));
  });
  act(() => {
    surface.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientY: 210 }));
  });
}

describe("Market Watch app", () => {
  it("shows the supplier page with inventory changes and the shared refresh surface", async () => {
    const content = await render();
    expect(content).toContain("Supplier updates");
    expect(content).toContain("Latest inventory from your suppliers");
    expect(content).toContain("Velvet Matte Lip Kit");

    // Monitored suppliers live in their own Watching section, above the table.
    expect(text()).toContain("Watching");
    // The reload control is the shared drag-down surface, not a button per page.
    expect(container.querySelector('[aria-label^="Pull down to refresh"]')).not.toBeNull();
  });

  it("refreshes all three monitoring pages from one drag-down gesture", async () => {
    await render();

    // One pull runs the workspace-wide scans, reads every watched site's own
    // catalogue, and re-reads the workspace — and it says which half is which.
    pullToRefresh();
    await act(async () => {});
    expect(text()).toContain("live scans ran");
    expect(text()).toContain("site scans ran");

    // The other two pages read the same workspace, so they are already current:
    // a second pull inside the hour animates, then says so instead of re-scanning.
    click(findByText("button", "Competition"));
    expect(container.querySelector('[aria-label^="Pull down to refresh"]')).not.toBeNull();
    pullToRefresh();
    await act(async () => {});
    expect(text()).toContain("Checking for new data");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 950));
    });
    expect(text()).toContain("Already up to date");
  });

  it("navigates to the competition page and shows keyword, social and local signals", async () => {
    await render();
    click(findByText("button", "Competition"));
    expect(text()).toContain("Competition watch");
    expect(text()).toContain("GlowMart Beauty");
    expect(text()).toContain("traffic and where it comes from");

    click(findByText("button", "Keywords"));
    expect(text()).toContain("Keyword & SEO gap vs your platform");

    // Their own catalogue: only what moved, which is what the pull's site scan
    // writes. An unchanged product is deliberately not a row here.
    click(findByText("button", "New inventory"));
    expect(text()).toContain("What changed on GlowMart Beauty's site");
    expect(text()).toContain("Glass Skin Toner 200ml");
    expect(text()).toContain("Price Change");
    expect(text()).toContain("Only changes are listed");

    click(findByExactText("button", "Social"));
    expect(text()).toContain("Recent posts they published");

    click(findByText("button", "Local"));
    expect(text()).toContain("Competitor review gap");
  });

  it("adds a competitor's social handle, which is the only source of scan targets", async () => {
    await render();
    click(findByText("button", "Competition"));
    click(findByExactText("button", "Social"));
    expect(text()).toContain("Social presence");

    click(findByText("button", "Add handle"));
    const dialog = activeDialog();
    typeInto(
      dialog.querySelector<HTMLInputElement>('input[placeholder="@glowmartbeauty"]'),
      "https://www.instagram.com/testrival/",
    );
    click(dialogButton("Save handle"));
    await act(async () => {});

    // The pasted profile URL is reduced to the bare handle before it is stored,
    // and Instagram is replaced rather than duplicated.
    expect(text()).toContain("testrival");
    // The Instagram card no longer carries the old handle (the substring check
    // avoids tripping on @glowmartbeautytv on their YouTube card).
    expect(text()).not.toContain("Instagram@glowmartbeauty");
    expect(text()).toContain("Instagram handle saved");

    // It can be taken off the monitoring list again.
    click(container.querySelector('button[aria-label="Stop monitoring Instagram"]'));
    await act(async () => {});

    expect(text()).toContain("Stopped monitoring Instagram");
    expect(text()).not.toContain("testrival");
  });

  it("adds a customer on the clients page from the add-customer dialog", async () => {
    await render();
    click(findByText("button", "Clients"));
    expect(text()).toContain("Customer list");

    click(findByText("button", "Add customer"));
    const dialog = activeDialog();
    typeInto(
      dialog.querySelector<HTMLInputElement>('input[placeholder="e.g. Amina Yusuf"]'),
      "Test Retailer",
    );
    typeInto(
      dialog.querySelector<HTMLInputElement>('input[placeholder="name@theirstore.com"]'),
      "owner@testretailer.com",
    );

    click(dialogButton("Add customer"));
    await act(async () => {});

    const content = text();
    expect(content).toContain("Test Retailer");
    expect(content).toContain("owner@testretailer.com");
    expect(content).toContain("added to the active customer list");
  });

  it("keeps the dashboard reachable in demo mode without auth keys", async () => {
    await render();
    expect(text()).toContain("Demo data");
    expect(text()).toContain("Supplier updates");
    expect(container.querySelector("nav")).not.toBeNull();
  });

  it("shows scores and rankings on the my business page", async () => {
    await render();
    click(findByText("button", "My Business"));
    expect(text()).toContain("My business");
    expect(text()).toContain("SEO score");
    expect(text()).not.toContain("Download pack");

    click(findByText("button", "SEO & GEO"));
    expect(text()).toContain("Top ranking SEO keywords this week");
    expect(text()).toContain("Top ranking GEO prompts this week");

    click(findByText("button", "Buy list"));
    expect(text()).toContain("Inventory you should get next");
  });

  it("shows the local visibility panel with rankings, map pack and profile health", async () => {
    await render();
    click(findByText("button", "My Business"));
    click(findByText("button", "Local"));

    const content = text();
    expect(content).toContain("Google rankings on your platform");
    expect(content).toContain("Google Business profile health");
    expect(content).toContain("Local map 3-pack tracker");
    expect(content).toContain("Profile health");
    expect(content).toContain("beauty shop near me");
    expect(content).toContain("Find keywords");
    // Share of Voice stat surfaces on the local panel too.
    expect(content).toContain("Share of voice");
    // Device toggle switches the ranking table without a reload.
    click(findByText("button", "Mobile"));
    expect(text()).toContain("mobile results");
  });

  it("finds keyword ideas and tracks one into the keyword list", async () => {
    await render();
    click(findByText("button", "My Business"));
    click(findByText("button", "Local"));
    click(findByText("button", "Find keywords"));

    const dialog = activeDialog();
    typeInto(
      dialog.querySelector<HTMLInputElement>('input[placeholder="e.g. velvet lip kit"]'),
      "hydra serum",
    );
    click(dialogButton("Find ideas"));
    await act(async () => {});

    expect(dialog.textContent ?? "").toContain("hydra serum near me");
    click(dialogButton("Track"));
    await act(async () => {});

    expect(dialog.textContent ?? "").toContain("Tracked");
  });

  it("shows share of voice and the competitor review gap on the competition local tab", async () => {
    await render();
    click(findByText("button", "Competition"));
    click(findByText("button", "Local"));

    const content = text();
    expect(content).toContain("Google local & share of voice");
    expect(content).toContain("Share of Voice");
    expect(content).toContain("Competitor review gap");
    expect(content).toContain("Run benchmark");
    expect(content).toContain("Local pack positions");
    // Default competitor is GlowMart, whose sample share is 80% vs our 60%.
    expect(content).toContain("80%");
    expect(content).toContain("3,182");
    expect(content).toContain("You hold");
  });

  it("raises local-visibility alerts for pack drops, lost snippets and share of voice", async () => {
    await render();
    click(container.querySelector('button[aria-label="Notifications"]'));

    const content = text();
    expect(content).toContain("phone accessories shop: dropped out of the map 3-pack");
    expect(content).toContain("anc earbuds under 50: rich snippet lost");
    expect(content).toContain("Share of Voice recovered above 50%");
  });

  it("renders the public landing page with its call to action", async () => {
    await act(async () => {
      root.render(<LandingPage />);
    });

    const content = text();
    expect(content).toContain("Market Watch");
    expect(content).toContain("Start free");
    expect(content).toContain("Watching for you");
    expect(content).toContain("Before you sign up.");

    // Screen gallery renders the workspace layouts with sample data.
    expect(content).toContain("Every screen, before you sign up.");
    expect(content).toContain("Suppliers monitored");
    expect(content).toContain("Competition");
  });

  it("keeps competitor alerts out of the customer messaging configuration", async () => {
    await render();
    click(findByText("button", "Clients"));
    click(findByText("button", "Configuration"));

    const dialog = activeDialog();
    const content = dialog.textContent ?? "";
    expect(content).toContain("What customers receive");
    expect(content).toContain("Send cadence");
    expect(content).not.toContain("Competitor alert");
  });

  it("lists scan alerts on the dedicated notifications page", async () => {
    await render();
    click(container.querySelector('button[aria-label="Notifications"]'));

    const content = text();
    expect(content).toContain("Everything your scans raised");
    expect(content).toContain("Needs action");
    expect(content).toContain("All notifications");
  });

  it("shows reviews and social on the dedicated social page", async () => {
    await render();
    click(findByText("button", "Social & reviews"));
    expect(text()).toContain("Review page analysis");
    expect(text()).toContain("Latest review scan");

    click(findByText("button", "Social media"));
    expect(text()).toContain("Social media score & where to focus");
  });

  it("lists the catalogue on the inventory page", async () => {
    await render();
    click(findByText("button", "Inventory & services"));
    expect(text()).toContain("Products & services");
    expect(text()).toContain("Velvet Matte Lip Kit");
  });

  it("builds an ad brief on the promotions page and keeps a history", async () => {
    await render();
    click(findByText("button", "Promotions"));
    const content = text();
    expect(content).toContain("Ad components");
    expect(content).toContain("Ad frame");
    expect(content).toContain("Ads history");
    expect(content).toContain("Discount type");
    expect(content).toContain("Update brief");
    expect(content).toContain("Lip kit — weekend sale");
    expect(content).toContain("In design");
  });

  it("opens the business profile dialog with the logo uploader", async () => {
    await render();
    click(container.querySelector('button[aria-label="Business profile"]'));
    const dialog = activeDialog();
    expect(dialog.textContent ?? "").toContain("Business logo");
    expect(dialog.textContent ?? "").toContain("Upload logo");
  });

  it("shows competitors' scraped posts beside their monitored social presence", async () => {
    await render();
    click(findByText("button", "Competition"));
    // "Social" is also part of the nav label "Social & reviews", so match the tab exactly.
    click(findByExactText("button", "Social"));

    const content = text();
    expect(content).toContain("Recent posts they published");
    expect(content).toContain("Scan posts now");
    expect(content).toContain("sold out twice is back in stock");
    // Engagement is measured from the scraped post, not the competitor's claim.
    expect(content).toContain("8.07% engagement");
    // The measured channels now sit beside the posts, in the second column.
    expect(content).toContain("Social presence");
    // Competitor content is labelled as a signal, never as artwork to reuse.
    expect(content).toContain("Their posts are a signal, never artwork.");
  });

  it("raises a posting-burst alert when a competitor posts three times in a day", async () => {
    await render();
    click(container.querySelector('button[aria-label="Notifications"]'));

    const content = text();
    expect(content).toContain("GlowMart Beauty: 3 posts in 24 hours");
    expect(content).toContain("GlowMart Beauty beat their 30-day engagement record");
  });

  it("lists provider integrations with connect prompts in business settings", async () => {
    await render();
    click(container.querySelector('button[aria-label="Business profile"]'));

    const content = activeDialog().textContent ?? "";
    expect(content).toContain("Integrations");
    for (const provider of ["SerpApi", "Apify", "Reviews", "Mallary.ai"]) {
      expect(content).toContain(provider);
    }
    // Demo mode has no provider secrets, so every row shows the connect prompt.
    expect(content).toContain("Not configured");
    expect(content).toContain("SERPAPI_KEY");
  });

  it("reports monitoring health in business settings", async () => {
    await render();
    click(container.querySelector('button[aria-label="Business profile"]'));

    const content = activeDialog().textContent ?? "";
    expect(content).toContain("Monitoring health");
    expect(content).toContain("Nothing needs attention");
    // The demo workspace records no provider calls, so there is no usage panel to
    // show — an honest readout rather than invented spend.
    expect(content).not.toContain("Plan usage this month");
  });

  it("lists connected review profiles and connects a new one", async () => {
    await render();
    click(findByText("button", "Social & reviews"));

    // Sample connections render next to the latest review scan.
    expect(text()).toContain("Review profiles");
    expect(text()).toContain("Trustpilot");

    click(findByText("button", "Connect"));
    const dialog = activeDialog();
    expect(dialog.textContent ?? "").toContain("Connect a review profile");

    typeInto(
      dialog.querySelector<HTMLInputElement>('input[placeholder="e.g. yourretailbrand.com"]'),
      "reviews.example.com",
    );
    click(dialogButton("Connect profile"));
    await act(async () => {});

    expect(text()).toContain("reviews.example.com");
  });

  it("opens the reply composer and records the reply against a review", async () => {
    await render();
    click(findByText("button", "Social & reviews"));

    // The sample reply on the first review is shown, not offered for editing.
    expect(text()).toContain("we would love a one-line quote");

    click(findByText("button", "Reply"));
    const dialog = activeDialog();
    expect(dialog.textContent ?? "").toContain("Reply to this review");
    expect(dialog.textContent ?? "").toContain("Peter M.");

    click(dialogButton("Send reply"));
    await act(async () => {});

    expect(text()).toContain("Reply sent to Peter M.");
  });

  it("drafts a review reply with AI without sending it", async () => {
    await render();
    click(findByText("button", "Social & reviews"));
    click(findByText("button", "Reply"));

    const dialog = activeDialog();
    const textarea = () => dialog.querySelector<HTMLTextAreaElement>("textarea")!;
    const before = textarea().value;

    click(dialogButton("Draft with AI"));
    await act(async () => {});

    // The draft lands in the composer, replacing the suggested action text, and
    // the composer is explicit that sending is still the user's decision.
    expect(textarea().value).not.toBe(before);
    expect(textarea().value.length).toBeGreaterThan(20);
    expect(dialog.textContent ?? "").toContain("Sending is still yours to do");
  });

  it("groups keyword ideas into intent themes, keeping every suggestion", async () => {
    await render();
    click(findByText("button", "My Business"));
    click(findByText("button", "Local"));
    click(findByText("button", "Find keywords"));

    const dialog = activeDialog();
    typeInto(
      dialog.querySelector<HTMLInputElement>('input[placeholder="e.g. velvet lip kit"]'),
      "hydra serum",
    );
    click(dialogButton("Find ideas"));
    await act(async () => {});

    // Grouping is offered once there is more than one suggestion to group.
    click(dialogButton("Group into themes"));
    await act(async () => {});

    const content = dialog.textContent ?? "";
    expect(content).toContain("Ready to buy");
    expect(content).toContain("Price and value");
    // A suggestion is never lost by grouping, and none is invented.
    expect(content).toContain("hydra serum near me");
    expect(content).toContain("nothing was added");
  });

  it("posts a delivered design to the connected accounts from the promotions page", async () => {
    await render();
    click(findByText("button", "Promotions"));

    // The Ad frame offers Post ad once a design is delivered.
    click(findByText("button", "Post ad"));
    const dialog = activeDialog();
    expect(dialog.textContent ?? "").toContain("Accounts");
    expect(dialog.textContent ?? "").toContain("Instagram");
    expect(dialog.textContent ?? "").toContain("Publish now");

    click(dialogButton("Publish now"));
    await act(async () => {});

    const content = text();
    expect(content).toContain("Ad posted");
    expect(content).toContain("View post");
    // The new job lands in Ads history and carries its permalink.
    const hrefs = Array.from(container.querySelectorAll("a")).map(
      (anchor) => anchor.getAttribute("href") ?? "",
    );
    expect(hrefs.some((href) => href.includes("social.example.com/p/demo-ad"))).toBe(true);
  });

  it("adds, edits and removes a competitor from the competition page", async () => {
    await render();
    click(findByText("button", "Competition"));
    expect(text()).toContain("GlowMart Beauty");

    // The confirm names the collateral before anything goes. GlowMart is the
    // default competitor and has measured data, so its note can be specific.
    click(findByExactText("button", "Remove"));
    expect(activeDialog().textContent ?? "").toContain("Stop watching GlowMart Beauty?");
    expect(activeDialog().textContent ?? "").toContain("monitored social profile");
    expect(activeDialog().textContent ?? "").toContain("cannot be undone");
    click(dialogButton("Keep watching"));
    await act(async () => {});
    expect(text()).toContain("GlowMart Beauty");

    // Add: an empty form is refused inline rather than saved as a blank row.
    click(findByText("button", "Add competitor"));
    let dialog = activeDialog();
    click(dialogButton("Add competitor"));
    await act(async () => {});
    expect(activeDialog().textContent ?? "").toContain("Add a name and a website address");

    dialog = activeDialog();
    typeInto(
      dialog.querySelector<HTMLInputElement>('input[placeholder="e.g. GlowMart Beauty"]'),
      "Halo Beauty Co",
    );
    // A bare domain is normalised to a URL, so the scan has something to open.
    typeInto(
      dialog.querySelector<HTMLInputElement>('input[placeholder="glowmart.com"]'),
      "halobeauty.com",
    );
    click(dialogButton("Add competitor"));
    await act(async () => {});

    expect(text()).toContain("Halo Beauty Co is now being watched.");
    // It becomes the active competitor rather than being added out of sight.
    expect(text()).toContain("Halo Beauty Co traffic and where it comes from");

    // Edit: the form opens prefilled from what is stored, and a website is
    // reduced to its host however it is typed.
    click(findByExactText("button", "Edit"));
    dialog = activeDialog();
    expect(dialog.querySelector<HTMLInputElement>('input[placeholder="glowmart.com"]')?.value).toBe(
      "https://halobeauty.com",
    );
    typeInto(
      dialog.querySelector<HTMLInputElement>('input[placeholder="glowmart.com"]'),
      "https://halobeauty.com/shop",
    );
    click(dialogButton("Save changes"));
    await act(async () => {});
    expect(text()).toContain("Halo Beauty Co updated");

    // Remove: one click only arms the button, the second does the delete.
    click(findByExactText("button", "Remove"));
    dialog = activeDialog();
    expect(dialog.textContent ?? "").toContain("Nothing else is stored against them yet");
    click(dialogButton("Remove competitor"));
    await act(async () => {});
    expect(text()).toContain("Halo Beauty Co");
    expect(activeDialog().textContent ?? "").toContain("Delete permanently");

    click(dialogButton("Delete permanently"));
    await act(async () => {});
    expect(text()).toContain("Stopped watching Halo Beauty Co");
    // The pill is gone (the toast naming it still on screen does not count).
    expect(findByExactText("button", "Halo Beauty Co")).toBeUndefined();
    // The page falls back to a competitor that still exists.
    expect(text()).toContain("GlowMart Beauty");
  });

  it("adds, edits and removes a supplier from the suppliers page", async () => {
    await render();
    expect(text()).toContain("Lumière Cosmetics Supply");
    const monitored = statValue("Suppliers monitored");

    // Add: an empty form is refused inline, then a full one is the last pill.
    click(findByText("button", "Add supplier"));
    let dialog = activeDialog();
    click(dialogButton("Add supplier"));
    await act(async () => {});
    expect(activeDialog().textContent ?? "").toContain("Add a name and a website address");

    dialog = activeDialog();
    typeInto(
      dialog.querySelector<HTMLInputElement>('input[placeholder="e.g. Lumière Cosmetics Supply"]'),
      "Test Packaging Co",
    );
    // A catalogue path is reduced to the host — the site is what gets scanned.
    typeInto(
      dialog.querySelector<HTMLInputElement>('input[placeholder="supplier.com"]'),
      "https://testpackaging.com/catalogue",
    );
    click(dialogButton("Add supplier"));
    await act(async () => {});

    expect(text()).toContain("Test Packaging Co is now being watched.");
    expect(statValue("Suppliers monitored")).toBe(monitored + 1);

    // Edit: the pencil beside the pill opens the same form, prefilled.
    click(container.querySelector('button[aria-label="Edit Test Packaging Co"]'));
    dialog = activeDialog();
    expect(dialog.textContent ?? "").toContain("Edit Test Packaging Co");
    typeInto(
      dialog.querySelector<HTMLInputElement>('input[placeholder="e.g. Lumière Cosmetics Supply"]'),
      "Test Packaging Ltd",
    );
    click(dialogButton("Save changes"));
    await act(async () => {});
    expect(text()).toContain("Test Packaging Ltd updated");

    // The confirm separates their detected items from our own catalogue, which
    // survives the delete, and only deletes on the second click.
    click(container.querySelector('button[aria-label="Edit Lumière Cosmetics Supply"]'));
    dialog = activeDialog();
    click(dialogButton("Remove supplier"));
    await act(async () => {});
    expect(activeDialog().textContent ?? "").toContain("Stop watching Lumière Cosmetics Supply?");
    expect(activeDialog().textContent ?? "").toContain("This also deletes the");
    expect(activeDialog().textContent ?? "").toContain("catalogue and ad briefs stay");
    click(dialogButton("Keep watching"));
    await act(async () => {});
    expect(text()).toContain("Lumière Cosmetics Supply");

    click(container.querySelector('button[aria-label="Edit Test Packaging Ltd"]'));
    dialog = activeDialog();
    click(dialogButton("Remove supplier"));
    await act(async () => {});
    click(dialogButton("Remove supplier"));
    await act(async () => {});
    expect(text()).toContain("Test Packaging Ltd");
    expect(activeDialog().textContent ?? "").toContain("Delete permanently");

    click(dialogButton("Delete permanently"));
    await act(async () => {});
    expect(text()).toContain("Stopped watching Test Packaging Ltd");
    // The pill and its manage button are gone (the toast still names it).
    expect(container.querySelector('button[aria-label="Edit Test Packaging Ltd"]')).toBeNull();
    expect(statValue("Suppliers monitored")).toBe(monitored);
  });

  it("proposes a competitor's socials from their own site, saving only what is ticked", async () => {
    // Any network call would be the gateway — which demo mode must never reach.
    const fetchSpy = vi.fn(() => {
      throw new Error("the demo flow must not reach the network");
    });
    vi.stubGlobal("fetch", fetchSpy);

    await render();
    click(findByText("button", "Competition"));
    // "Social" is also part of the nav label "Social & reviews", so match the tab exactly.
    click(findByExactText("button", "Social"));
    expect(text()).toContain("Social presence");

    click(findByText("button", "Find socials from their site"));
    await act(async () => {});

    // The read names the site it read, pre-fills a handle, and reports the
    // platform it found but has no scraper for — listed, never saved.
    expect(text()).toContain("Read from glowmartbeauty.com");
    expect(text()).toContain("Found, not monitored: YouTube");
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="Instagram handle"]')?.value,
    ).toBe("glowmartbeauty");

    // Nothing is written by the read itself: every monitorable profile starts
    // ticked, but accepting is still a separate, explicit click.
    expect(text()).toContain("Save 3 profiles");

    // Unticking one takes it out of the payload entirely.
    click(container.querySelector('button[aria-label="Save TikTok profile"]'));
    await act(async () => {});
    expect(text()).toContain("Save 2 profiles");

    click(findByText("button", "Save 2 profiles"));
    await act(async () => {});
    expect(text()).toContain("Saved 2 discovered profiles for GlowMart Beauty.");

    // The saved rows are badged as found rather than typed, and the row now says
    // when it was last read.
    expect(text()).toContain("found on their site");
    expect(text()).toContain("Last checked");
    expect(container.querySelector('input[aria-label="Instagram handle"]')).toBeNull();

    // No function — and so no key, run or spend — was ever involved.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

});
