import { afterEach, describe, expect, it } from "vitest";

import { focusIsLost, focusOrigin, rememberOrigin, returnFocus } from "./focus";

function setup() {
  document.body.innerHTML = `
    <main id="main" tabindex="-1">
      <button id="opener">Settings</button>
      <div role="dialog" data-modal id="dialog"><input id="box" /></div>
      <aside id="panel"><button id="close">Close panel</button></aside>
    </main>`;
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  return { main: $("main"), opener: $("opener"), dialog: $("dialog"), box: $("box"), panel: $("panel"), close: $("close") };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("focusOrigin", () => {
  it("is the focused element, or null on <body>", () => {
    const { opener } = setup();
    expect(focusOrigin()).toBeNull();
    opener.focus();
    expect(focusOrigin()).toBe(opener);
  });

  it("inside a modal dialog, is what had focus before the dialog opened", () => {
    const { opener, dialog, box } = setup();
    opener.focus();
    expect(rememberOrigin(dialog)).toBe(opener);
    box.focus();
    expect(focusOrigin()).toBe(opener);
  });
});

describe("returnFocus", () => {
  it("gives focus back to the opener when focus was lost", () => {
    const { opener } = setup();
    expect(document.activeElement).toBe(document.body);
    expect(returnFocus(opener)).toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  it("treats focus inside a closing layer as lost", () => {
    const { opener, panel, close } = setup();
    close.focus();
    expect(focusIsLost(panel)).toBe(true);
    returnFocus(opener, panel);
    expect(document.activeElement).toBe(opener);
  });

  it("falls back to the main content when the opener has gone", () => {
    const { opener, main } = setup();
    opener.remove();
    returnFocus(opener);
    expect(document.activeElement).toBe(main);
  });

  it("leaves focus alone when it is already somewhere on purpose", () => {
    const { opener, close } = setup();
    close.focus();
    expect(returnFocus(opener)).toBe(true);
    expect(document.activeElement).toBe(close);
  });

  it("skips an opener inside an inert region", () => {
    const { opener, main } = setup();
    const wrapper = document.createElement("div");
    wrapper.setAttribute("inert", "");
    main.prepend(wrapper);
    wrapper.append(opener);
    returnFocus(opener);
    expect(document.activeElement).toBe(main);
  });
});
