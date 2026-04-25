"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type PipelineEvent =
  | { type: "status"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; name: string; ok: boolean; summary: string }
  | {
      type: "signal_recorded";
      competitor: string;
      signal_type: string;
      summary: string;
      confidence: number;
    }
  | { type: "done"; signals: number; duration_ms: number }
  | { type: "error"; message: string }
  | { type: "composing" }
  | {
      type: "composed";
      subject: string;
      threat_level: number;
      bullets: number;
      actions: number;
    }
  | { type: "rendered"; html_chars: number }
  | { type: "sending"; to: string }
  | { type: "sent"; resend_id: string; brief_id: string }
  | { type: "dry_run" };

type Status = "idle" | "running" | "done" | "error";

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${String(r).padStart(2, "0")}s` : `${s}s`;
}

function EventLine({ event }: { event: PipelineEvent }) {
  switch (event.type) {
    case "status":
      return (
        <div className="flex gap-3 py-0.5">
          <span className="text-[color:var(--color-info)] shrink-0">[status]</span>
          <span>{event.text}</span>
        </div>
      );

    case "thinking":
      return (
        <div className="py-0.5 text-[color:var(--color-text-muted)] whitespace-pre-wrap">
          {event.text}
        </div>
      );

    case "tool_call":
      return (
        <div className="flex gap-3 py-0.5 items-baseline">
          <span className="text-[color:var(--color-warn)] shrink-0">&gt;</span>
          <span className="text-[color:var(--color-text)] shrink-0">{event.name}</span>
          <span className="text-[color:var(--color-text-dim)] truncate">
            {truncate(JSON.stringify(event.input), 140)}
          </span>
        </div>
      );

    case "tool_result":
      return (
        <div className="flex gap-3 py-0.5 pl-6">
          <span
            className={
              event.ok
                ? "text-[color:var(--color-ok)] shrink-0"
                : "text-[color:var(--color-err)] shrink-0"
            }
          >
            {event.ok ? "ok" : "fail"}
          </span>
          <span className="text-[color:var(--color-text-muted)]">{event.summary}</span>
        </div>
      );

    case "signal_recorded":
      return (
        <div className="py-1.5 my-1 border-l-2 border-[color:var(--color-ok)] pl-3">
          <div className="flex gap-2 text-[color:var(--color-text)] text-xs">
            <span className="text-[color:var(--color-ok)]">[signal]</span>
            <span>{event.competitor}</span>
            <span className="text-[color:var(--color-text-dim)]">/</span>
            <span>{event.signal_type}</span>
            <span className="text-[color:var(--color-text-dim)]">/</span>
            <span>{Math.round(event.confidence * 100)}%</span>
          </div>
          <div className="text-[color:var(--color-text-muted)] mt-1">
            {event.summary}
          </div>
        </div>
      );

    case "composing":
      return (
        <div className="py-0.5 mt-3 text-[color:var(--color-info)]">[composing]</div>
      );

    case "composed":
      return (
        <div className="py-0.5 flex gap-3 pl-6 text-[color:var(--color-text-muted)]">
          <span>threat {event.threat_level}/10</span>
          <span className="text-[color:var(--color-text-dim)]">·</span>
          <span>{event.bullets} bullet{event.bullets === 1 ? "" : "s"}</span>
          <span className="text-[color:var(--color-text-dim)]">·</span>
          <span>{event.actions} action{event.actions === 1 ? "" : "s"}</span>
        </div>
      );

    case "rendered":
      return (
        <div className="py-0.5 pl-6 text-[color:var(--color-text-muted)]">
          rendered {event.html_chars.toLocaleString()} chars
        </div>
      );

    case "sending":
      return (
        <div className="py-0.5 mt-3 text-[color:var(--color-info)]">
          [sending] <span className="text-[color:var(--color-text-muted)]">&rarr; {event.to}</span>
        </div>
      );

    case "sent":
      return (
        <div className="py-0.5 pl-6 text-[color:var(--color-ok)]">
          sent · resend {event.resend_id.slice(0, 8)}
        </div>
      );

    case "dry_run":
      return (
        <div className="py-0.5 mt-3 text-[color:var(--color-warn)]">
          [dry-run] not sending
        </div>
      );

    case "done":
      return (
        <div className="py-2 mt-3 text-[color:var(--color-ok)]">
          [done] {event.signals} signal{event.signals === 1 ? "" : "s"} in{" "}
          {formatElapsed(event.duration_ms)}
        </div>
      );

    case "error":
      return (
        <div className="py-0.5 text-[color:var(--color-err)]">[error] {event.message}</div>
      );
  }
}

export default function Home() {
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [dryRun, setDryRun] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const elapsed = useMemo(
    () => (startedAt ? now - startedAt : 0),
    [startedAt, now],
  );

  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [status]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const start = () => {
    if (status === "running") return;
    setEvents([]);
    setStatus("running");
    setStartedAt(Date.now());
    setNow(Date.now());

    const params = new URLSearchParams();
    if (dryRun) params.set("dry", "1");
    const url = `/api/run${params.toString() ? `?${params}` : ""}`;

    const source = new EventSource(url);
    sourceRef.current = source;

    source.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as PipelineEvent;
        setEvents((prev) => [...prev, ev]);
        if (ev.type === "sent" || ev.type === "dry_run") {
          source.close();
          setStatus("done");
        }
        if (ev.type === "error") {
          source.close();
          setStatus("error");
        }
      } catch {}
    };

    source.onerror = () => {
      source.close();
      sourceRef.current = null;
      setStatus((s) => (s === "done" ? s : "error"));
    };
  };

  const stop = () => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    setStatus("idle");
  };

  useEffect(() => {
    return () => {
      if (sourceRef.current) sourceRef.current.close();
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "r" && status !== "running" && !e.metaKey && !e.ctrlKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        e.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [status, dryRun]);

  const dateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const statusLabel: Record<Status, string> = {
    idle: "idle",
    running: "running",
    done: "done",
    error: "error",
  };

  return (
    <main className="flex flex-col flex-1 w-full max-w-5xl mx-auto px-6 py-8 gap-4">
      <header className="flex items-center justify-between border-b border-[color:var(--color-border)] pb-4">
        <div className="flex items-baseline gap-3">
          <span className="text-[color:var(--color-text-dim)] text-xs uppercase tracking-[0.12em]">
            // daily founder brief
          </span>
          <span className="text-[color:var(--color-text-dim)] text-xs">
            {dateStr}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-[color:var(--color-text-muted)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              disabled={status === "running"}
              className="accent-[color:var(--color-text)]"
            />
            dry-run
          </label>
          {status === "running" ? (
            <button
              onClick={stop}
              className="border border-[color:var(--color-border-strong)] px-3 py-1 text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] hover:border-[color:var(--color-text-dim)] transition-colors"
            >
              stop
            </button>
          ) : (
            <button
              onClick={start}
              className="border border-[color:var(--color-text-dim)] px-3 py-1 text-xs text-[color:var(--color-text)] hover:border-[color:var(--color-text)] transition-colors"
            >
              run <span className="text-[color:var(--color-text-dim)]">[r]</span>
            </button>
          )}
        </div>
      </header>

      <div
        ref={scrollRef}
        className="scroll-thin flex-1 min-h-[520px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4 overflow-y-auto text-xs leading-relaxed"
      >
        {events.length === 0 ? (
          <div className="text-[color:var(--color-text-dim)]">
            {status === "running"
              ? "waiting for first event…"
              : "press [r] or click run to begin investigation."}
          </div>
        ) : (
          events.map((ev, i) => <EventLine key={i} event={ev} />)
        )}
      </div>

      <footer className="flex items-center justify-between border-t border-[color:var(--color-border)] pt-3 text-[11px] text-[color:var(--color-text-dim)]">
        <div className="flex items-center gap-3">
          <span>
            <span
              className={
                status === "running"
                  ? "text-[color:var(--color-warn)]"
                  : status === "done"
                    ? "text-[color:var(--color-ok)]"
                    : status === "error"
                      ? "text-[color:var(--color-err)]"
                      : ""
              }
            >
              {statusLabel[status]}
            </span>
          </span>
          <span>·</span>
          <span>
            {events.length} event{events.length === 1 ? "" : "s"}
          </span>
          <span>·</span>
          <span>{formatElapsed(elapsed)}</span>
        </div>
        <div>toneswap</div>
      </footer>
    </main>
  );
}
