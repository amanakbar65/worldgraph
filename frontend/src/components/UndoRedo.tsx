import { Redo2, Undo2 } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
// The values that can be undone register themselves when loaded.
import "@/state/notes";
import "@/state/profile";
import { loadUndoLog, nextRedo, nextUndo, redo, undo, useUndo, type UndoScope } from "@/state/undo";

/** Is focus in a field that has its own undo (typing)? */
function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return !["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"].includes(target.type);
}

/**
 * Ctrl/Cmd+Z undoes the viewer's last personal edit and Shift+Ctrl/Cmd+Z
 * (or Ctrl+Y) redoes it, except in a text field, which keeps its own undo.
 * Also the polite live region that says "Undone: …". Mounted once by App.
 */
export function UndoShortcuts() {
  const message = useUndo((s) => s.message);

  useEffect(() => {
    void loadUndoLog();
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      const redoKey = (key === "z" && event.shiftKey) || (key === "y" && event.ctrlKey && !event.shiftKey);
      if (!redoKey && !(key === "z" && !event.shiftKey)) return;
      if (isTextField(event.target)) return;
      event.preventDefault();
      void (redoKey ? redo() : undo());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The same words twice in a row still get read: alternate a trailing no-break space.
  const text = message ? `${message.text}${message.n % 2 ? "" : " "}` : "";
  return (
    <div role="status" aria-live="polite" className="sr-only" data-testid="undo-announcer">
      {text}
    </div>
  );
}

export interface UndoRedoButtonsProps {
  /** Which edits these buttons act on (a page's own, say); all by default. */
  scope?: UndoScope;
  /** Read in the group's name and when there is nothing to do: "Nothing to undo in this note". */
  noun?: string;
  /** Icons only (tight rows); the words stay in the names and tooltips. */
  compact?: boolean;
  className?: string;
}

/** Undo and Redo for the viewer's own edits, shown where the edits happen. */
export function UndoRedoButtons({ scope, noun, compact = false, className }: UndoRedoButtonsProps) {
  const toUndo = useUndo((s) => nextUndo(s, scope));
  const toRedo = useUndo((s) => nextRedo(s, scope));
  useEffect(() => void loadUndoLog(), []);
  const undoName = toUndo ? `Undo ${toUndo.label}` : `Nothing to undo${noun ? ` in ${noun}` : ""}`;
  const redoName = toRedo ? `Redo ${toRedo.label}` : `Nothing to redo${noun ? ` in ${noun}` : ""}`;
  return (
    <div role="group" aria-label={noun ? `Undo and redo ${noun}` : "Undo and redo"} className={cn("flex items-center", className)}>
      <Button
        variant="ghost"
        size={compact ? "icon" : "sm"}
        className={compact ? undefined : "px-2"}
        disabled={!toUndo}
        onClick={() => void undo(scope)}
        aria-label={undoName}
        title={undoName}
      >
        <Undo2 aria-hidden />
        {!compact && "Undo"}
      </Button>
      <Button
        variant="ghost"
        size={compact ? "icon" : "sm"}
        className={compact ? undefined : "px-2"}
        disabled={!toRedo}
        onClick={() => void redo(scope)}
        aria-label={redoName}
        title={redoName}
      >
        <Redo2 aria-hidden />
        {!compact && "Redo"}
      </Button>
    </div>
  );
}
