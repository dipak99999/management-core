"use client";

import { useEffect, useRef, useState } from "react";

export interface RealtimeMessage<T = unknown> {
  type: string;
  data: T;
  id?: string;
}

interface Opts<T = unknown> {
  /** Fully-qualified SSE endpoint. */
  url: string;
  /** Event types to listen for; defaults to a single "message" handler. */
  events?: string[];
  /** Only subscribe when true. Lets you gate on auth state. */
  enabled?: boolean;
  /** Called for each incoming message. */
  onMessage?: (m: RealtimeMessage<T>) => void;
  /** Called when the connection flips open/closed. */
  onStatus?: (s: "connecting" | "open" | "closed") => void;
  /** Reconnect delay baseline (ms). Exponential backoff caps at 30s. */
  reconnectBaseMs?: number;
}

/**
 * Minimal SSE hook. Connects to `url`, re-establishes on close with
 * exponential backoff, surfaces status + last message. Prefer SSE over
 * WebSockets for one-way server pushes behind HTTP infrastructure.
 */
export function useRealtime<T = unknown>(opts: Opts<T>): {
  status: "connecting" | "open" | "closed";
  last: RealtimeMessage<T> | null;
} {
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("closed");
  const [last, setLast] = useState<RealtimeMessage<T> | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  // Keep latest handlers available without re-subscribing.
  const onMessageRef = useRef(opts.onMessage);
  const onStatusRef = useRef(opts.onStatus);
  onMessageRef.current = opts.onMessage;
  onStatusRef.current = opts.onStatus;

  useEffect(() => {
    if (!opts.enabled && opts.enabled !== undefined) {
      return;
    }
    if (!opts.url) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;

    stoppedRef.current = false;

    const connect = () => {
      if (stoppedRef.current) return;
      setStatus("connecting");
      onStatusRef.current?.("connecting");
      const es = new EventSource(opts.url, { withCredentials: true });
      esRef.current = es;

      es.onopen = () => {
        attemptRef.current = 0;
        setStatus("open");
        onStatusRef.current?.("open");
      };

      const handle = (type: string) => (e: MessageEvent) => {
        let data: T;
        try {
          data = JSON.parse(e.data) as T;
        } catch {
          data = e.data as unknown as T;
        }
        const msg: RealtimeMessage<T> = { type, data, id: e.lastEventId };
        setLast(msg);
        onMessageRef.current?.(msg);
      };

      if (opts.events && opts.events.length) {
        for (const ev of opts.events) {
          es.addEventListener(ev, handle(ev) as EventListener);
        }
      } else {
        es.onmessage = handle("message");
      }

      es.onerror = () => {
        es.close();
        esRef.current = null;
        setStatus("closed");
        onStatusRef.current?.("closed");
        if (stoppedRef.current) return;
        const attempt = ++attemptRef.current;
        const base = opts.reconnectBaseMs ?? 1000;
        const delay = Math.min(base * 2 ** (attempt - 1), 30000);
        timerRef.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      stoppedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      esRef.current?.close();
      esRef.current = null;
    };
  }, [opts.url, opts.enabled, opts.reconnectBaseMs, opts.events]);

  return { status, last };
}
