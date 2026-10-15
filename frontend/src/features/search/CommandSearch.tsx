import { keepPreviousData } from "@tanstack/react-query";
import { Command } from "cmdk";
import {
  Briefcase,
  Clock,
  CornerDownLeft,
  Globe2,
  Lightbulb,
  MessageCircleQuestion,
  Network,
  Newspaper,
  Search,
  SearchX,
  Settings2,
  SunMoon,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { EntityType } from "@/api/contract";
import { useRpc } from "@/api/client";
import { ErrorState } from "@/components/ErrorState";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { ENTITY_TYPE_ICONS } from "@/lib/icons";
import { entityTypeTone } from "@/lib/meaning";
import { cn } from "@/lib/utils";
import { useUserValue } from "@/platform/storage";
import { useNav, type View } from "@/state/nav";
import { useSettings } from "@/state/settings";
import { useUi } from "@/state/ui";

import {
  MIN_QUERY,
  SEARCH_LIMIT,
  addRecent,
  contextLabel,
  groupResults,
  matchActions,
  panelFor,
  parseRecent,
  type ActionInfo,
  type RecentItem,
  type SearchResult,
} from "./search-data";
import { useDebounced } from "./use-debounced";

/**
 * Ctrl/Cmd+K search: places, companies, stories, forecasts and more,
 * grouped by type. Arrow keys move, Enter opens the right panel (a place
 * also flies the globe there), Escape closes. Before typing it shows recent
 * searches and quick actions.
 */
export function CommandSearch() {
  const open = useUi((s) => s.searchOpen);
  const setOpen = useUi((s) => s.setSearchOpen);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useUi.getState().searchOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {open && (
        <DialogContent
          hideClose
          aria-describedby={undefined}
          className={cn(
            "top-3 w-[min(40rem,calc(100vw-24px))] max-w-none translate-y-0 gap-0 overflow-hidden p-0 sm:top-[12dvh]",
            "max-h-[min(36rem,calc(100dvh-24px))] sm:max-h-[min(36rem,76dvh)]",
          )}
        >
          <DialogTitle className="sr-only">Search WorldGraph</DialogTitle>
          <DialogDescription className="sr-only">
            Type to find places, companies, stories and forecasts. Use the arrow keys to move and Enter to open.
          </DialogDescription>
          <Palette onDone={() => setOpen(false)} />
        </DialogContent>
      )}
    </Dialog>
  );
}

interface QuickAction extends ActionInfo {
  icon: LucideIcon;
  run: () => void;
}

const SCREENS: { view: View; label: string; icon: LucideIcon; pinned?: boolean }[] = [
  { view: "globe", label: "Go to Globe", icon: Globe2 },
  { view: "forecasts", label: "Go to Forecasts", icon: Users, pinned: true },
  { view: "brief", label: "Open the daily brief", icon: Newspaper, pinned: true },
  { view: "business", label: "Go to My Business", icon: Briefcase },
  { view: "opportunities", label: "Go to Opportunities", icon: Lightbulb },
  { view: "graph", label: "Go to Graph", icon: Network },
];

function currentTheme(): "dark" | "light" {
  const attr = document.documentElement.getAttribute("data-wg-theme");
  return attr === "light" ? "light" : "dark";
}

function Palette({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  const query = text.trim();
  const debounced = useDebounced(query, 200);
  const searching = debounced.length >= MIN_QUERY;
  const search = useRpc(
    "search",
    { q: debounced, limit: SEARCH_LIMIT },
    { enabled: searching, staleTime: 60_000, refetchInterval: false, placeholderData: keepPreviousData },
  );
  const stored = useUserValue<unknown>("recent-searches", []);
  const recent = useMemo(() => parseRecent(stored.value), [stored.value]);

  const open = useNav((s) => s.open);
  const flyTo = useNav((s) => s.flyTo);
  const setView = useNav((s) => s.setView);
  const updateSettings = useSettings((s) => s.update);

  const go = (item: RecentItem) => {
    onDone();
    stored.setValue((prev: unknown) => addRecent(parseRecent(prev), item));
    open(panelFor(item));
    if (item.type === "region") flyTo({ regionId: item.id });
  };

  const theme = currentTheme();
  const actions: QuickAction[] = [
    {
      id: "ask",
      label: query.length >= MIN_QUERY ? `Ask: “${query}”` : "Ask a question",
      keywords: ["ask", "question", "answer", "why", "how", "what"],
      pinned: true,
      icon: MessageCircleQuestion,
      run: () => open(query.length >= MIN_QUERY ? { kind: "ask", q: query } : { kind: "ask" }),
    },
    ...SCREENS.map((s) => ({
      id: `view-${s.view}`,
      label: s.label,
      keywords: ["go", "open", "screen", "view", s.view],
      pinned: s.pinned,
      icon: s.icon,
      run: () => setView(s.view),
    })),
    {
      id: "theme",
      label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      keywords: ["toggle", "theme", "dark", "light", "mode", "colour", "color"],
      pinned: true,
      icon: SunMoon,
      run: () => updateSettings({ theme: theme === "dark" ? "light" : "dark" }),
    },
    {
      id: "settings",
      label: "Open settings",
      keywords: ["settings", "preferences", "sample", "borders", "motion", "sources", "about"],
      pinned: true,
      icon: Settings2,
      run: () => open({ kind: "settings" }),
    },
  ];
  // While typing, "Ask" always stays on offer: the question may not match a name.
  const shownActions = query
    ? [...actions.filter((a) => a.id === "ask"), ...matchActions(actions, query).filter((a) => a.id !== "ask")]
    : matchActions(actions, "");
  const runAction = (action: QuickAction) => {
    onDone();
    action.run();
  };

  const results = searching ? (search.data?.results ?? []) : [];
  const groups = groupResults(results);
  const loading = searching && search.isFetching;
  const stale = searching && search.isPlaceholderData;
  const waiting = query.length >= MIN_QUERY && (debounced !== query || (search.isPending && !search.isError));

  return (
    <Command shouldFilter={false} loop label="Search WorldGraph" className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Search aria-hidden className="size-4 shrink-0 text-fg-muted" />
        <Command.Input
          value={text}
          onValueChange={setText}
          placeholder="Search places, companies, stories, forecasts…"
          maxLength={80}
          className="h-13 min-w-0 flex-1 bg-transparent text-body text-fg outline-none placeholder:text-fg-subtle"
        />
        {loading && (
          <span role="status" className="shrink-0 text-label text-fg-subtle">
            Searching…
          </span>
        )}
        <button
          type="button"
          onClick={onDone}
          aria-label="Close search"
          className="-mr-1 flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <span className="hidden sm:inline">
            <Kbd>Esc</Kbd>
          </span>
          <X aria-hidden className="size-4 sm:hidden" />
        </button>
      </div>

      <Command.List
        aria-label="Results"
        className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 transition-opacity", stale && "opacity-70")}
      >
        {!query && recent.length > 0 && (
          <Command.Group heading={<GroupHeading icon={Clock}>Recent</GroupHeading>}>
            {recent.map((item) => (
              <ResultItem key={item.id} item={item} onSelect={() => go(item)} />
            ))}
          </Command.Group>
        )}

        {query.length > 0 && query.length < MIN_QUERY && (
          <p className="px-3 py-3 text-body text-fg-muted">Keep typing: two letters or more.</p>
        )}

        {waiting && results.length === 0 && <ResultSkeleton />}

        {searching && search.isError && !search.data && (
          <ErrorState compact error={search.error} onRetry={() => void search.refetch()} />
        )}

        {groups.map((group) => (
          <Command.Group
            key={group.type}
            heading={
              <GroupHeading icon={ENTITY_TYPE_ICONS[group.type]?.icon ?? Search}>{group.label}</GroupHeading>
            }
          >
            {group.items.map((item) => (
              <ResultItem key={item.id} item={item} onSelect={() => go(item)} />
            ))}
          </Command.Group>
        ))}

        {searching && !waiting && !search.isError && results.length === 0 && (
          <div className="flex items-start gap-3 px-3 py-3">
            <SearchX aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
            <div className="flex flex-col gap-0.5">
              <p className="text-body text-fg">No matches for “{debounced}”</p>
              <p className="text-label text-fg-muted">Try a country, city, company or commodity, or ask it as a question.</p>
            </div>
          </div>
        )}

        {shownActions.length > 0 && (
          <Command.Group heading={<GroupHeading>{query ? "Actions" : "Quick actions"}</GroupHeading>}>
            {shownActions.map((action) => (
              <Command.Item
                key={action.id}
                value={action.id}
                onSelect={() => runAction(action)}
                className={ITEM_CLASS}
              >
                <span
                  aria-hidden
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2/60"
                >
                  <action.icon className="size-4 text-fg-muted" />
                </span>
                <span className="min-w-0 flex-1 truncate text-body text-fg">{action.label}</span>
                <EnterHint />
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>

      <div
        aria-hidden
        className="hidden items-center gap-4 border-t border-line px-4 py-2 text-label text-fg-subtle sm:flex"
      >
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          Move
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd>
          Open
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Esc</Kbd>
          Close
        </span>
      </div>
    </Command>
  );
}

const ITEM_CLASS =
  "group flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none data-[selected=true]:bg-surface-2";

function GroupHeading({ icon: Icon, children }: { icon?: LucideIcon; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-label font-medium text-fg-muted">
      {Icon && <Icon aria-hidden className="size-3.5" />}
      {children}
    </span>
  );
}

function EnterHint() {
  return (
    <CornerDownLeft
      aria-hidden
      className="hidden size-4 shrink-0 text-fg-subtle group-data-[selected=true]:sm:block"
    />
  );
}

function ResultItem({ item, onSelect }: { item: RecentItem | SearchResult; onSelect: () => void }) {
  const tone = entityTypeTone(item.type);
  const Icon = (ENTITY_TYPE_ICONS[item.type as EntityType] ?? ENTITY_TYPE_ICONS.story).icon;
  const context = contextLabel(item);
  return (
    <Command.Item value={item.id} onSelect={onSelect} className={ITEM_CLASS}>
      <span
        aria-hidden
        className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg border", tone.tint, tone.border)}
      >
        <Icon className={cn("size-4", tone.text)} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body text-fg">{item.name}</span>
        {context && <span className="truncate text-label text-fg-muted">{context}</span>}
      </span>
      <EnterHint />
    </Command.Item>
  );
}

function ResultSkeleton() {
  return (
    <div className="flex flex-col gap-1 p-1" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 px-1 py-2">
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className={cn("h-3.5", i % 2 ? "w-2/5" : "w-3/5")} />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
