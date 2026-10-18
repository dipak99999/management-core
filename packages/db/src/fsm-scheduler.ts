// Field Service Management — technician→job assignment helper.
//
// Given a queue of open service jobs (each with required skills + a
// preferred window) and a list of available technicians (each with
// their skills, current location, and shift window), returns the
// best-fit assignment for each job.
//
// v1 scoring: skill match is required (all job.requiredSkills must be
// a subset of tech.skills); ties broken by
//   1. tech window fully contains the job window (hard preference)
//   2. shorter geo distance (haversine)
//
// Kept pure so it can be unit-tested without a DB.

import { haversineMeters } from "./geo-fence";

export interface TechnicianAvailability {
  employeeId: string;
  employeeName: string;
  skills: string[];
  homeLatitude?: number;
  homeLongitude?: number;
  windowStart: Date; // when the tech's shift begins
  windowEnd: Date;   // when the tech's shift ends
  bookedMinutes?: number; // total already-scheduled load for the day
}

export interface ServiceJob {
  jobId: string;
  requiredSkills: string[];
  latitude: number;
  longitude: number;
  windowStart: Date;
  windowEnd: Date;
  estimatedMinutes: number;
  priority?: number; // 1=high .. 3=low (default 2)
}

export interface Assignment {
  jobId: string;
  employeeId: string | null;
  score: number; // higher = better; -1 = no fit
  reason: string;
  distanceMeters?: number;
}

function skillsCover(need: string[], have: string[]): boolean {
  return need.every((s) => have.includes(s));
}

function windowOverlaps(a: { s: Date; e: Date }, b: { s: Date; e: Date }): boolean {
  return a.s <= b.e && b.s <= a.e;
}

export function assignJobs(
  jobs: ServiceJob[],
  techs: TechnicianAvailability[],
): Assignment[] {
  const load = new Map<string, number>();
  for (const t of techs) load.set(t.employeeId, t.bookedMinutes ?? 0);

  const sortedJobs = [...jobs].sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2));

  const out: Assignment[] = [];
  for (const job of sortedJobs) {
    let best: { tech: TechnicianAvailability; score: number; distance: number } | null = null;
    for (const t of techs) {
      if (!skillsCover(job.requiredSkills, t.skills)) continue;
      if (!windowOverlaps(
        { s: t.windowStart, e: t.windowEnd },
        { s: job.windowStart, e: job.windowEnd },
      )) continue;
      // capacity: don't over-book beyond the tech's shift length.
      const shiftMinutes = (t.windowEnd.getTime() - t.windowStart.getTime()) / 60000;
      const alreadyBooked = load.get(t.employeeId) ?? 0;
      if (alreadyBooked + job.estimatedMinutes > shiftMinutes) continue;

      const distance =
        t.homeLatitude != null && t.homeLongitude != null
          ? haversineMeters(t.homeLatitude, t.homeLongitude, job.latitude, job.longitude)
          : 0;
      // Score components (higher = better):
      //   +100 window fully contains job window
      //   -distance/1000 (each km reduces score by 1)
      //   -alreadyBooked/60 (each hour of load reduces by 1)
      let score = 0;
      if (t.windowStart <= job.windowStart && t.windowEnd >= job.windowEnd) score += 100;
      score -= distance / 1000;
      score -= alreadyBooked / 60;
      if (!best || score > best.score) {
        best = { tech: t, score, distance };
      }
    }
    if (!best) {
      out.push({ jobId: job.jobId, employeeId: null, score: -1, reason: "no-fit" });
      continue;
    }
    load.set(best.tech.employeeId, (load.get(best.tech.employeeId) ?? 0) + job.estimatedMinutes);
    out.push({
      jobId: job.jobId,
      employeeId: best.tech.employeeId,
      score: best.score,
      reason: "best-fit",
      distanceMeters: best.distance,
    });
  }
  return out;
}
