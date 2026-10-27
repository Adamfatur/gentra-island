// What the black core under the notch shows: one thing at a time, the most
// urgent first. Everything else waits in the droplets.

export interface CoreInput {
  /** An agent asking for permission. */
  ask?: { agent: string; summary: string } | null;
  /** The mic is in use by a call. */
  call?: { app: string; muted: boolean } | null;
  /** An agent working, since `since` (Unix ms). */
  agent?: { agent: string; project: string; since: number } | null;
  /** A focus session, ending at `endsAt` (Unix ms). */
  focus?: { endsAt: number; paused: boolean } | null;
  /** A file the browser is still downloading. */
  download?: { name: string; bytes: number; total: number | null } | null;
}

export type Core =
  | { kind: "ask"; agent: string; summary: string }
  | { kind: "call"; app: string; muted: boolean }
  | { kind: "agent"; agent: string; project: string; since: number }
  | { kind: "focus"; endsAt: number; paused: boolean }
  | { kind: "download"; name: string; bytes: number; total: number | null }
  | { kind: "idle" };

/** Someone needs you, then a call, an agent, focus, a download, then nothing. */
export function pickCore(i: CoreInput): Core {
  if (i.ask) return { kind: "ask", ...i.ask };
  if (i.call) return { kind: "call", ...i.call };
  if (i.agent) return { kind: "agent", ...i.agent };
  if (i.focus) return { kind: "focus", ...i.focus };
  if (i.download) return { kind: "download", ...i.download };
  return { kind: "idle" };
}

/** Minutes and seconds as the dot-matrix readout shows them: 4:12, 25:00, 1:02:03. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
