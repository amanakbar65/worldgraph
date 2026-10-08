import {
  CircleHelp,
  CloudOff,
  FileWarning,
  KeyRound,
  PlugZap,
  RotateCw,
  SearchX,
  ServerCrash,
  ShieldCheck,
  WifiOff,
  type LucideIcon,
} from "lucide-react";

import { DataError, type DataErrorKind } from "@/api/source";
import { EmptyState } from "@/components/EmptyState";

interface Copy {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Label for the retry button; null hides it (retrying won't help). */
  retry: string | null;
}

const COPY: Record<DataErrorKind | "not_found" | "unknown", Copy> = {
  connector_missing: {
    icon: PlugZap,
    title: "Connect Supabase to see the data",
    description: "Add the Supabase connector in claude.ai under Settings → Connectors, then try again.",
    retry: "Try again",
  },
  connector_reauth: {
    icon: KeyRound,
    title: "Supabase needs you to sign in again",
    description: "Reconnect it in claude.ai under Settings → Connectors, then try again.",
    retry: "Try again",
  },
  not_allowed: {
    icon: ShieldCheck,
    title: "This page needs your OK",
    description: "Allow it to read WorldGraph data through your Supabase connector when asked.",
    retry: "Ask again",
  },
  unavailable: {
    icon: CloudOff,
    title: "The data is taking a moment",
    description: "The database didn't answer. It may be waking up; a retry usually works.",
    retry: "Retry",
  },
  bad_response: {
    icon: FileWarning,
    title: "We couldn't read that answer",
    description: "The data came back in an unexpected shape. Try again, or open another view.",
    retry: "Try again",
  },
  server_error: {
    icon: ServerCrash,
    title: "This view hit a snag",
    description: "The database couldn't build it. Try again, or open another view.",
    retry: "Try again",
  },
  offline: {
    icon: WifiOff,
    title: "No data source here",
    description: "This view has no data connection. Open the full app to see live data.",
    retry: null,
  },
  not_found: {
    icon: SearchX,
    title: "No longer available",
    description: "This item was removed or merged. Search to find what replaced it.",
    retry: null,
  },
  unknown: {
    icon: CircleHelp,
    title: "Something went wrong",
    description: "Try again in a moment.",
    retry: "Try again",
  },
};

function copyFor(error: Error): Copy {
  if (/^not found/i.test(error.message)) return COPY.not_found;
  if (error instanceof DataError) return COPY[error.kind] ?? COPY.unknown;
  return COPY.unknown;
}

export interface ErrorStateProps {
  /** The failure. A DataError gets advice for its kind; a "Not found…" message gets "No longer available". */
  error: Error;
  /** Called by the retry button; without it the button is hidden. */
  onRetry?: () => void;
  /** Tighter spacing for use inside cards and lists. */
  compact?: boolean;
  className?: string;
}

/**
 * A friendly error: what happened in plain words and the one thing to do
 * next. The technical message stays out of the way (in a tooltip).
 */
export function ErrorState({ error, onRetry, compact, className }: ErrorStateProps) {
  const copy = copyFor(error);
  return (
    <div title={error.message} className={className}>
      <EmptyState
        role="alert"
        icon={copy.icon}
        title={copy.title}
        description={copy.description}
        compact={compact}
        action={copy.retry && onRetry ? { label: copy.retry, onClick: onRetry, icon: RotateCw } : undefined}
      />
    </div>
  );
}
