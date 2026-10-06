import { Construction } from "lucide-react";

export function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 p-6 text-center text-fg-muted">
      <Construction aria-hidden className="size-6" />
      <p className="text-body">{title} is being built.</p>
    </div>
  );
}
