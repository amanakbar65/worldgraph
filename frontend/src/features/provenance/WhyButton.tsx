/**
 * The ways into "Why is this here?" (kg.provenance): a small mark after a
 * chip or row ("?" when the item is weak, an info mark otherwise), and a
 * labelled button for cards. Both open the sheet as a panel, so Back and
 * Escape return to where the viewer was.
 */
import { FileSearch, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { WeakMark } from "@/components/WeakMark";
import { WEAK_LINK_LABEL } from "@/lib/meaning";
import { cn } from "@/lib/utils";

import { WEAK_WORDS, WHY, whyLabel, type ProvenanceTarget } from "./provenance-data";
import { useOpenWhy } from "./use-why";

/**
 * A small round button after an item: the "?" mark when it is weak (so the
 * mark itself answers "why?"), else a quiet info mark. 24 px to the eye,
 * 40 px to the touch.
 */
export function WhyMark({
  target,
  id,
  subject,
  link = false,
  weak = false,
  className,
}: {
  target: ProvenanceTarget;
  id: string | number;
  /** The item's name, or the link in words ("DP World, operates, Jebel Ali Port"). */
  subject: string;
  link?: boolean;
  weak?: boolean;
  className?: string;
}) {
  const openWhy = useOpenWhy();
  return (
    <button
      type="button"
      onClick={() => openWhy(target, id)}
      aria-label={whyLabel(subject, { link, weak })}
      title={weak ? `${WEAK_LINK_LABEL}. Why is this here?` : "Why is this here?"}
      className={cn(
        "relative inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-fg-subtle transition-colors before:absolute before:-inset-2 before:content-[''] hover:bg-surface-2 hover:text-fg",
        className,
      )}
    >
      {weak ? <WeakMark /> : <Info aria-hidden className="size-3.5" />}
    </button>
  );
}

/** "Why is this here?" as a button with words, for cards (a chosen graph link, a globe arc). */
export function WhyButton({
  target,
  id,
  subject,
  weak = false,
  onOpen,
  className,
}: {
  target: ProvenanceTarget;
  id: string | number;
  /** What it is about, said after the question: "DP World, operates, Jebel Ali Port". */
  subject: string;
  weak?: boolean;
  /** Called after the sheet opens (e.g. to clear a selection it covers). */
  onOpen?: () => void;
  className?: string;
}) {
  const openWhy = useOpenWhy();
  // The name starts with the words on the button, then says what it is about.
  const label = [WHY, subject.trim() && `${subject.trim().replace(/\.$/, "")}.`, weak && WEAK_WORDS]
    .filter(Boolean)
    .join(" ");
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        openWhy(target, id);
        onOpen?.();
      }}
      aria-label={label}
      className={cn("px-2.5", className)}
    >
      {weak ? <WeakMark /> : <FileSearch aria-hidden />}
      {WHY}
    </Button>
  );
}
