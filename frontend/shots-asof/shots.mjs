// Light-theme screenshots of the as-of banner, its form, and a note's Undo/Redo row (plus the phone note row in dark).
import { chromium, devices } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:5417";
const out = new URL("./", import.meta.url).pathname;
const GRAPH_CALLS = new Set(["graph", "graph_as_of", "local_graph", "local_graph_as_of"]);
const pad = (x) => String(x).padStart(2, "0");
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

async function open(device, theme, sample) {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext(
    device === "phone" ? { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } : { viewport: { width: 1440, height: 900 } },
  );
  await ctx.addInitScript(
    (s) => localStorage.setItem("worldgraph.settings.v1", JSON.stringify(s)),
    { theme, calm: true, sample },
  );
  const page = await ctx.newPage();
  await page.route("**/api/rpc", async (route) => {
    const body = route.request().postDataJSON();
    if (!GRAPH_CALLS.has(body.fn)) return route.continue();
    const { at, ...args } = body.args;
    const response = await route.fetch({
      postData: JSON.stringify({ fn: body.fn.replace(/_as_of$/, ""), args: { ...args, sample: true } }),
    });
    const json = await response.json();
    if (body.fn.endsWith("_as_of") && json.data) {
      json.data.as_of = `${at}T23:59:59.999999+00:00`;
      json.data.history_starts = `${daysAgo(20)}T09:00:00+00:00`;
    }
    return route.fulfill({ response, json });
  });
  return { browser, page };
}

async function banner(device, theme, withForm) {
  const { browser, page } = await open(device, theme, "off");
  await page.goto(`${base}/#graph&at=${daysAgo(3)}`);
  await page.getByTestId("as-of-banner").getByRole("status").getByText(/^Showing/).waitFor({ state: "attached", timeout: 30000 });
  await page.waitForTimeout(1500);
  if (withForm) {
    await page.getByTestId("as-of-control").click();
    await page.getByLabel("Day to show").waitFor();
  }
  await page.screenshot({ path: `${out}${device}-${theme}-banner${withForm ? "-form" : ""}.png` });
  await browser.close();
}

async function note(device, theme) {
  const { browser, page } = await open(device, theme, "on");
  await page.goto(`${base}/#entity=commodity:crude-oil`);
  const note = page.getByRole("textbox", { name: "Your note on Crude oil" });
  await note.waitFor({ timeout: 30000 });
  await note.fill("Check freight rates before the OPEC+ meeting.");
  await page.getByText("Saved", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Undo note on Crude oil" }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Undo note on Crude oil" }).hover();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}${device}-${theme}-note.png` });
  await browser.close();
}

// await banner("desktop", "light", true);
// await banner("phone", "light", false);
// await banner("phone", "dark", true);
await note("phone", "light");
// await note("desktop", "light");
console.log("done");
