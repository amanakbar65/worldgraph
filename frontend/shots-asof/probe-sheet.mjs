// Probe: where the phone sheet sits at half and at full height, and whether its last line can be scrolled on screen.
import { chromium, devices } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:5417";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() =>
  localStorage.setItem("worldgraph.settings.v1", JSON.stringify({ theme: "dark", calm: true, sample: "on" })),
);
const page = await ctx.newPage();
await page.goto(base + "/#entity=commodity:crude-oil");
const sheet = page.getByRole("dialog", { name: "Details" });
const note = sheet.getByRole("textbox", { name: "Your note on Crude oil" });
await note.waitFor({ timeout: 30000 });
await page.waitForTimeout(1200);
const measure = (label) =>
  sheet.evaluate((el, label) => {
    const r = el.getBoundingClientRect();
    const a = document.activeElement;
    label += ` [focus: ${a?.tagName} ${a?.getAttribute("aria-label") ?? ""}; vaul ${el.style.transform}]`;
    const scroller = el.querySelector(".overflow-y-auto");
    scroller.scrollTop = scroller.scrollHeight;
    const last = scroller.lastElementChild.getBoundingClientRect();
    return `${label}: sheet top ${Math.round(r.top)} bottom ${Math.round(r.bottom)} (screen ${innerHeight}); scrolled to the end, content ends at ${Math.round(last.bottom)}`;
  }, label);
console.log(await measure("half"));
await note.focus();
await page.waitForTimeout(1200);
console.log(await measure("after focus"));
await page.screenshot({ path: new URL("./probe-sheet.png", import.meta.url).pathname });
await browser.close();
