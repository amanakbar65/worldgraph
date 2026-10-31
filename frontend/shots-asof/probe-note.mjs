// Probe: phone, Sample data on, an entity page's note: type, then Undo and Redo.
import { chromium, devices } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:5417";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
await ctx.addInitScript(() =>
  localStorage.setItem("worldgraph.settings.v1", JSON.stringify({ theme: "dark", calm: true, sample: "on" })),
);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(base + "/#entity=commodity:crude-oil");
const panel = page.getByRole("dialog", { name: "Details" });
const note = panel.getByRole("textbox", { name: "Your note on Crude oil" });
await note.waitFor({ timeout: 30000 });
await note.fill("First thought");
await panel.getByRole("region", { name: "Your note" }).getByRole("status").getByText("Saved").waitFor({ timeout: 10000 });
const undo = panel.getByRole("button", { name: "Undo note on Crude oil" });
console.log("undo box", await undo.boundingBox(), "viewport", page.viewportSize());
const hit = await undo.evaluate((el) => {
  el.scrollIntoView({ block: "center" });
  const b = el.getBoundingClientRect();
  const h = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
  return h ? (el.contains(h) ? "reaches it" : h.outerHTML.slice(0, 300)) : "none";
});
console.log("hit", hit);
try {
  await undo.click({ timeout: 5000 });
  console.log("undo click ok; value now:", JSON.stringify(await note.inputValue()));
} catch (e) {
  console.log("undo click failed:", e.message.split("\n").slice(0, 16).join("\n"));
}
const redo = panel.getByRole("button", { name: /^Redo note/ });
try {
  await redo.click({ timeout: 5000 });
  console.log("redo click ok; value now:", JSON.stringify(await note.inputValue()));
} catch (e) {
  console.log("redo click failed:", e.message.split("\n").slice(0, 16).join("\n"));
}
await page.screenshot({ path: new URL("./probe-note.png", import.meta.url).pathname });
await browser.close();
