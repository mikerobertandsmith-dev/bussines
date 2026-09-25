import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../src/App";

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

function typeInto(input: HTMLInputElement | null, value: string) {
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

async function render() {
  await act(async () => {
    root.render(<App />);
  });
  return text();
}

describe("Market Watch app", () => {
  it("shows the supplier page with inventory changes and cadence controls", async () => {
    const content = await render();
    expect(content).toContain("Supplier updates");
    expect(content).toContain("Latest inventory from your suppliers");
    expect(content).toContain("Monitored supplier sites");
    expect(content).toContain("Velvet Matte Lip Kit");
    expect(content).toContain("Scan now");
    expect(content).toContain("Daily");
  });

  it("navigates to the competition page and shows ad, keyword and review signals", async () => {
    await render();
    click(findByText("button", "Competition"));
    const content = text();
    expect(content).toContain("Competition watch");
    expect(content).toContain("GlowMart Beauty");
    expect(content).toContain("traffic and where it comes from");
    expect(content).toContain("Keyword & SEO gap vs your platform");
    expect(content).toContain("Banner link");
    expect(content).toContain("Reviews their customers are leaving");
  });

  it("adds a customer on the clients page", async () => {
    await render();
    click(findByText("button", "Clients"));
    expect(text()).toContain("Add a current active customer");

    const inputs = container.querySelectorAll("input");
    typeInto(inputs[0] as HTMLInputElement, "Test Retailer");
    typeInto(inputs[1] as HTMLInputElement, "owner@testretailer.com");

    click(findByText("button", "Add customer"));
    await act(async () => {});

    const content = text();
    expect(content).toContain("Test Retailer");
    expect(content).toContain("owner@testretailer.com");
    expect(content).toContain("added to the active customer list");
  });

  it("keeps the dashboard reachable in demo mode without auth keys", async () => {
    await render();
    expect(text()).toContain("Demo data");
    expect(text()).toContain("Market Watch");
    expect(container.querySelector("nav")).not.toBeNull();
  });

  it("shows scores, rankings and ad assets on the my business page", async () => {
    await render();
    click(findByText("button", "My Business"));
    const content = text();
    expect(content).toContain("My business");
    expect(content).toContain("SEO score");
    expect(content).toContain("Top ranking SEO keywords this week");
    expect(content).toContain("Top ranking GEO prompts this week");
    expect(content).toContain("Review page analysis");
    expect(content).toContain("Download pack");
    expect(content).toContain("Inventory you should get next");
  });
});
