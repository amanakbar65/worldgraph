/**
 * Ask as a conversation, with a stand-in for WorldGraph AI (POST /api/ai is
 * answered by the test, from the stories the page sends with the question):
 * - an answer cites only stored stories, and a follow-up carries the
 *   conversation (the earlier question and answer go with it as history);
 * - the thread stays while the panel is closed, and "New chat" clears it;
 * - a turn whose answer fails offers "Try again" for that turn only, which
 *   sends the same question with the same history;
 * - Stop ends an answer that is still being written.
 * The "no AI at all" case is in ask.spec.ts.
 */
import type { Page, Request, Route } from "@playwright/test";

import { detailsPanel, expect, openApp, snap, test } from "./fixtures";

const Q1 = "How do Red Sea attacks affect shipping costs?";
const Q2 = "What about India?";
const READ_AS_2 = "How do Red Sea attacks affect shipping costs for India?";
const FOLLOW_UP = "Which ports gain from the Cape route?";

interface AiBody {
  task: string;
  input: {
    question: string;
    context: {
      stories: { id: string; headline: string }[];
      links: { from: string; to: string }[];
      forecasts: { id: string }[];
    };
  };
  history?: { question: string; answer: string }[];
}

type Reply = { status: number; json: unknown } | "hold";

/**
 * Answer POST /api/ai like the website's function would: an "ask" answer
 * citing the first stories of the context it was sent. `plan` picks, call by
 * call, a normal answer ("ok"), a server failure, or "hold" (never answers
 * until the page gives up, for Stop).
 */
async function standInAi(page: Page, plan: ("ok" | "fail" | "hold")[] = []) {
  const calls: AiBody[] = [];
  await page.route("**/api/ai", async (route: Route, request: Request) => {
    const body = request.postDataJSON() as AiBody;
    calls.push(body);
    const step = plan[calls.length - 1] ?? "ok";
    const reply: Reply =
      step === "hold"
        ? "hold"
        : step === "fail"
          ? { status: 500, json: { error: "WorldGraph AI hit a snag. Try again." } }
          : { status: 200, json: { data: answerFor(body) } };
    if (reply === "hold") return; // left hanging: the page aborts it on Stop
    await route.fulfill({ status: reply.status, json: reply.json }).catch(() => {});
  });
  return calls;
}

/** The first point of every stand-in answer, so the test can find it on screen. */
function pointFor(question: string): string {
  return `Stand-in point about ${question.replace(/[?.]/g, "").toLowerCase()}`
    .split(/\s+/)
    .slice(0, 25)
    .join(" ");
}

function answerFor(body: AiBody) {
  const stories = body.input.context.stories;
  const isFollowUp = (body.history ?? []).length > 0;
  return {
    status: "answered",
    ...(isFollowUp ? { read_as: READ_AS_2 } : {}),
    bullets: [{ text: pointFor(body.input.question), cite: stories.slice(0, 2).map((s) => s.id) }],
    cascade: [],
    forecasts: [],
    follow_up: [FOLLOW_UP],
  };
}

function conversation(page: Page) {
  return detailsPanel(page).getByRole("log", { name: "Conversation" });
}

/** Type a question and send it with the Send button (the same on phones and desktop). */
async function send(page: Page, question: string) {
  const panel = detailsPanel(page);
  await panel.getByRole("textbox", { name: "Your question" }).fill(question);
  await panel.getByRole("button", { name: "Send", exact: true }).click();
}

test.describe("Ask as a conversation", () => {
  test("an answer cites stored stories, and a follow-up carries the conversation", async ({
    page,
  }, testInfo) => {
    const calls = await standInAi(page);
    await openApp(page, "#ask");
    const panel = detailsPanel(page);
    const box = panel.getByRole("textbox", { name: "Your question" });
    await expect(box).toHaveAttribute("placeholder", "How does X affect Y?");

    await send(page, Q1);
    const first = conversation(page).getByRole("article", { name: Q1 });
    await expect(first.getByText(pointFor(Q1))).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.task).toBe("ask");
    expect(calls[0]!.history, "a first question goes without history").toBeUndefined();

    // Each point names the stories it comes from, and they are the stories the page sent.
    const cited = calls[0]!.input.context.stories.slice(0, 2);
    expect(cited.length).toBeGreaterThan(0);
    const answer = first.getByRole("region", { name: /^Answer/ });
    for (const story of cited) {
      await expect(answer.getByRole("button", { name: `Source story: ${story.headline}` })).toBeVisible();
    }
    await expect(answer).toContainText(
      `Written by WorldGraph AI from ${cited.length} cited ${cited.length === 1 ? "story" : "stories"}.`,
    );
    // Sample stories are labelled in the answer too.
    await expect(answer.getByText(/^Sample( data)?$/).filter({ visible: true }).first()).toBeVisible();

    // The box now asks for a follow-up, and the answer offers one.
    await expect(box).toHaveAttribute("placeholder", "Ask a follow-up…");
    await expect(first.getByRole("region", { name: "Ask next" })).toContainText(FOLLOW_UP);
    await snap(page, testInfo, "ask-chat-first-answer");

    // A follow-up reads against the question before it.
    await send(page, Q2);
    const second = conversation(page).getByRole("article", { name: Q2 });
    await expect(second.getByText(pointFor(Q2))).toBeVisible();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.input.question).toBe(Q2);
    expect(calls[1]!.history).toEqual([{ question: Q1, answer: `- ${pointFor(Q1)}` }]);
    // How the AI read it is shown under the question.
    await expect(second.getByText(`Read as “${READ_AS_2}”`)).toBeVisible();

    // Both turns stay, in order, and only the newest offers questions to ask next.
    await expect(conversation(page).getByRole("article")).toHaveCount(2);
    await expect(conversation(page).getByRole("article").first()).toHaveAccessibleName(Q1);
    await expect(conversation(page).getByRole("region", { name: "Ask next" })).toHaveCount(1);
    await expect(second.getByRole("region", { name: "Ask next" })).toBeVisible();

    // A suggested follow-up is sent as it is, with both earlier turns as history.
    await second.getByRole("button", { name: FOLLOW_UP }).click();
    await expect(
      conversation(page).getByRole("article", { name: FOLLOW_UP }).getByText(pointFor(FOLLOW_UP)),
    ).toBeVisible();
    expect(calls).toHaveLength(3);
    expect(calls[2]!.history?.map((t) => t.question)).toEqual([Q1, Q2]);
    await snap(page, testInfo, "ask-chat-follow-ups");
  });

  test("the thread stays while the panel is closed, and New chat starts again", async ({
    page,
    isPhone,
  }) => {
    await standInAi(page);
    await openApp(page, "#ask");
    const panel = detailsPanel(page);
    await send(page, Q1);
    await expect(conversation(page).getByRole("article", { name: Q1 }).getByText(pointFor(Q1))).toBeVisible();

    // A cited story opens over Ask; Back returns to the same conversation.
    await conversation(page).getByRole("button", { name: /^Source story: / }).first().click();
    await expect(panel.getByRole("article").getByRole("heading", { level: 2 })).toBeVisible();
    await panel.getByRole("button", { name: "Back", exact: true }).click();
    await expect(conversation(page).getByRole("article", { name: Q1 })).toBeVisible();

    // Closed and opened again from the header: still there.
    await panel.getByRole("button", { name: "Close panel" }).click();
    await expect(panel).toBeHidden();
    await page
      .locator("header")
      .getByRole("button", { name: /^Ask( a question)?$/ })
      .click();
    await expect(conversation(page).getByRole("article", { name: Q1 })).toBeVisible();

    // New chat: an empty thread with suggestions, and the box ready for a first question.
    await panel.getByRole("button", { name: "New chat" }).click();
    await expect(conversation(page).getByRole("article")).toHaveCount(0);
    await expect(conversation(page).getByRole("region", { name: "Try asking" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "New chat" })).toHaveCount(0);
    const box = panel.getByRole("textbox", { name: "Your question" });
    await expect(box).toHaveValue("");
    await expect(box).toHaveAttribute("placeholder", "How does X affect Y?");
    // Focus goes somewhere useful: the box on desktop, the panel's heading on phones (no keyboard popping up).
    if (isPhone) await expect(panel.getByRole("heading", { level: 2, name: "Ask WorldGraph" })).toBeFocused();
    else await expect(box).toBeFocused();
  });

  test("a failed answer retries that turn only, with the same history", async ({ page }, testInfo) => {
    // The first question answers, the follow-up fails once, its retry answers.
    const calls = await standInAi(page, ["ok", "fail", "ok"]);
    await openApp(page, "#ask");
    const panel = detailsPanel(page);
    await send(page, Q1);
    await expect(conversation(page).getByRole("article", { name: Q1 }).getByText(pointFor(Q1))).toBeVisible();

    await send(page, Q2);
    const second = conversation(page).getByRole("article", { name: Q2 });
    const problem = second.getByRole("alert");
    await expect(problem).toContainText("The answer didn't arrive");
    await expect(problem).toContainText("WorldGraph AI hit a snag. Try again.");
    // What WorldGraph found is still shown, as facts from sources.
    await expect(second.getByRole("region", { name: /^Closest stories in WorldGraph/ })).toBeVisible();
    // The earlier answer is untouched, and it is the only turn with a retry.
    await expect(conversation(page).getByRole("article", { name: Q1 }).getByText(pointFor(Q1))).toBeVisible();
    await expect(conversation(page).getByRole("button", { name: "Try again" })).toHaveCount(1);
    await snap(page, testInfo, "ask-chat-failed-turn");

    await problem.getByRole("button", { name: "Try again" }).click();
    await expect(second.getByText(pointFor(Q2))).toBeVisible();
    await expect(second.getByRole("alert")).toHaveCount(0);
    expect(calls).toHaveLength(3);
    // The retry sends the same question with the history it was first asked with.
    expect(calls[2]!.input.question).toBe(Q2);
    expect(calls[2]!.history).toEqual(calls[1]!.history);
    expect(calls[2]!.history).toEqual([{ question: Q1, answer: `- ${pointFor(Q1)}` }]);
    // Still two turns: a retry doesn't add one.
    await expect(conversation(page).getByRole("article")).toHaveCount(2);
    await expect(panel.getByRole("textbox", { name: "Your question" })).toHaveAttribute(
      "placeholder",
      "Ask a follow-up…",
    );
  });

  test("Stop ends an answer being written, and Ask again sends it again", async ({ page }) => {
    const calls = await standInAi(page, ["hold", "ok"]);
    await openApp(page, "#ask");
    const panel = detailsPanel(page);
    await send(page, Q1);
    const turn = conversation(page).getByRole("article", { name: Q1 });
    await expect(turn.getByText(/Writing the answer…/)).toBeVisible();
    await expect.poll(() => calls.length).toBe(1);

    // While it is written, Send becomes Stop.
    await expect(panel.getByRole("button", { name: "Send", exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: "Stop the answer" }).click();
    await expect(turn.getByText("Stopped. Nothing more was sent.")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Send", exact: true })).toBeVisible();

    await turn.getByRole("button", { name: "Ask again" }).click();
    await expect(turn.getByText(pointFor(Q1))).toBeVisible();
    expect(calls).toHaveLength(2);
  });
});
