// Probe: phone, Sample data on, open #graph and tap the as-of control.
import { chromium, devices } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:5417";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
await ctx.addInitScript(() =>
  localStorage.setItem("worldgraph.settings.v1", JSON.stringify({ theme: "dark", calm: true, sample: "on" })),
);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(base + "/#graph");
const control = page.getByTestId("as-of-control");
await control.waitFor({ timeout: 30000 });
console.log("aria-disabled", await control.getAttribute("aria-disabled"), "label", await control.getAttribute("aria-label"));
console.log("box", await control.boundingBox());
const hit = await control.evaluate((el) => {
  const b = el.getBoundingClientRect();
  const h = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
  return h ? h.outerHTML.slice(0, 200) : "none";
});
console.log("hit", hit);
try {
  await control.click({ timeout: 5000 });
  console.log("click ok");
} catch (e) {
  console.log("click failed:", e.message.split("\n").slice(0, 14).join("\n"));
}
try {
  await control.tap({ timeout: 5000, force: true });
  console.log("forced tap ok");
} catch (e) {
  console.log("tap failed:", e.message.split("\n").slice(0, 6).join("\n"));
}
await page.screenshot({ path: new URL("./probe.png", import.meta.url).pathname });
await browser.close();
