"use client";

// Mobile-friendly check-in page. Grabs the camera stream + a
// geolocation fix, then posts to /employee-checkins (mobile source)
// or /employee-checkins/face (face-recognition source).
//
// Installable as a PWA — add-to-home-screen turns this into a
// one-tap in/out punch for field/site workers.

import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { Button, Card, PageHeader, StatusBadge } from "../../components/ui";

interface Emp {
  id: string;
  employeeCode: string;
  employeeName: string;
  faceEnrolledAt: string | null;
}

type Mode = "geo" | "face";
type LogType = "IN" | "OUT";

export default function CheckinPage() {
  const [employees, setEmployees] = useState<Emp[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [mode, setMode] = useState<Mode>("geo");
  const [logType, setLogType] = useState<LogType>("IN");
  const [pos, setPos] = useState<GeolocationPosition | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    api.get<Emp[]>("/employees").then(setEmployees).catch(() => {});
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoError("Geolocation not supported by this browser");
      return;
    }
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        setPos(p);
        setGeoError(null);
      },
      (e) => setGeoError(e.message),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, []);

  useEffect(() => {
    if (mode !== "face") {
      // Tear down camera when switching modes.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (e) {
        setMsg({
          kind: "error",
          text: e instanceof Error ? e.message : "Camera permission denied",
        });
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [mode]);

  async function submit() {
    if (!employeeId) {
      setMsg({ kind: "error", text: "Pick an employee first" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "geo") {
        if (!pos) throw new Error("Waiting for a GPS fix — try again in a moment");
        await api.post("/employee-checkins", {
          employeeId,
          ts: new Date().toISOString(),
          logType,
          source: "mobile",
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
      } else {
        if (!videoRef.current || !canvasRef.current) throw new Error("Camera not ready");
        const canvas = canvasRef.current;
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Cannot capture — canvas 2d unavailable");
        ctx.drawImage(videoRef.current, 0, 0);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        const base64 = dataUrl.split(",")[1] ?? "";
        await api.post("/employee-checkins/face", {
          employeeId,
          ts: new Date().toISOString(),
          logType,
          imageBase64: base64,
        });
      }
      setMsg({ kind: "success", text: `Checked ${logType} at ${new Date().toLocaleTimeString()}` });
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  const enrolledFor = employees.find((e) => e.id === employeeId);
  const faceReady = mode === "face" ? enrolledFor?.faceEnrolledAt != null : true;

  return (
    <main className="p-4 max-w-md mx-auto space-y-4">
      <PageHeader
        title="Check In / Out"
        subtitle="Mobile geo + face recognition check-in"
      />

      <Card className="p-3 space-y-3">
        <label className="block">
          <span className="text-xs text-ink-muted">Employee</span>
          <select
            className="input mt-1"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">— Select —</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.employeeName} ({e.employeeCode})
              </option>
            ))}
          </select>
        </label>

        <div className="flex gap-2">
          <button
            type="button"
            className={`flex-1 py-2 rounded ${logType === "IN" ? "bg-green-600 text-white" : "border border-ink-muted/20"}`}
            onClick={() => setLogType("IN")}
          >
            IN
          </button>
          <button
            type="button"
            className={`flex-1 py-2 rounded ${logType === "OUT" ? "bg-orange-600 text-white" : "border border-ink-muted/20"}`}
            onClick={() => setLogType("OUT")}
          >
            OUT
          </button>
        </div>

        <div className="flex gap-2 text-sm">
          <button
            type="button"
            className={`flex-1 py-1.5 rounded ${mode === "geo" ? "bg-brand-100 text-brand-800" : "border border-ink-muted/20"}`}
            onClick={() => setMode("geo")}
          >
            GPS
          </button>
          <button
            type="button"
            className={`flex-1 py-1.5 rounded ${mode === "face" ? "bg-brand-100 text-brand-800" : "border border-ink-muted/20"}`}
            onClick={() => setMode("face")}
          >
            Face
          </button>
        </div>
      </Card>

      {mode === "geo" && (
        <Card className="p-3">
          <div className="text-sm">
            {pos ? (
              <>
                <div className="font-mono text-xs">
                  {pos.coords.latitude.toFixed(6)}, {pos.coords.longitude.toFixed(6)}
                </div>
                <div className="text-ink-muted text-xs mt-1">
                  ±{Math.round(pos.coords.accuracy)} m accuracy
                </div>
              </>
            ) : (
              <div className="text-ink-muted">Waiting for GPS fix…</div>
            )}
            {geoError ? <div className="text-red-700 text-xs mt-1">{geoError}</div> : null}
          </div>
        </Card>
      )}

      {mode === "face" && (
        <Card className="p-3 space-y-2">
          {!faceReady ? (
            <div className="text-sm text-red-700">
              Employee has no enrolled face. Ask HR to enroll first.
            </div>
          ) : (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="w-full aspect-square object-cover bg-black rounded"
            />
          )}
          <canvas ref={canvasRef} className="hidden" />
        </Card>
      )}

      {msg ? (
        <div
          className={`p-3 rounded text-sm ${
            msg.kind === "success" ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {msg.text}
        </div>
      ) : null}

      <Button
        className="w-full"
        onClick={submit}
        disabled={busy || (mode === "geo" && !pos) || (mode === "face" && !faceReady)}
      >
        {busy ? "Sending…" : `Check ${logType}`}
      </Button>

      {enrolledFor?.faceEnrolledAt ? (
        <div className="text-center text-xs text-ink-muted">
          <StatusBadge status={enrolledFor.faceEnrolledAt ? "Face enrolled" : "Not enrolled"} />
        </div>
      ) : null}
    </main>
  );
}
