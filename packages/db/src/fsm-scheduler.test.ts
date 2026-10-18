import { describe, expect, it } from "vitest";
import { assignJobs, type ServiceJob, type TechnicianAvailability } from "./fsm-scheduler";

const nine = new Date("2026-10-05T09:00:00Z");
const six = new Date("2026-10-05T18:00:00Z");
const ten = new Date("2026-10-05T10:00:00Z");
const eleven = new Date("2026-10-05T11:00:00Z");

const techs: TechnicianAvailability[] = [
  {
    employeeId: "e-alice",
    employeeName: "Alice",
    skills: ["plumbing", "electrical"],
    homeLatitude: 12.9716, homeLongitude: 77.5946, // Bengaluru
    windowStart: nine, windowEnd: six,
    bookedMinutes: 0,
  },
  {
    employeeId: "e-bob",
    employeeName: "Bob",
    skills: ["hvac"],
    homeLatitude: 12.9716, homeLongitude: 77.5946,
    windowStart: nine, windowEnd: six,
    bookedMinutes: 0,
  },
];

const jobHvac: ServiceJob = {
  jobId: "j-1",
  requiredSkills: ["hvac"],
  latitude: 12.973, longitude: 77.5946,
  windowStart: ten, windowEnd: eleven,
  estimatedMinutes: 60,
};

const jobPlumbing: ServiceJob = {
  jobId: "j-2",
  requiredSkills: ["plumbing"],
  latitude: 12.973, longitude: 77.5946,
  windowStart: ten, windowEnd: eleven,
  estimatedMinutes: 60,
};

describe("assignJobs", () => {
  it("routes each job to the only tech with matching skills", () => {
    const out = assignJobs([jobHvac, jobPlumbing], techs);
    expect(out.find((a) => a.jobId === "j-1")?.employeeId).toBe("e-bob");
    expect(out.find((a) => a.jobId === "j-2")?.employeeId).toBe("e-alice");
  });

  it("returns no-fit when no tech has the required skill", () => {
    const out = assignJobs(
      [{ ...jobHvac, requiredSkills: ["welding"] }],
      techs,
    );
    expect(out[0].employeeId).toBeNull();
    expect(out[0].reason).toBe("no-fit");
  });

  it("respects window overlap", () => {
    // Job at midnight; tech shift 9-6.
    const outOfWindow: ServiceJob = {
      ...jobHvac,
      windowStart: new Date("2026-10-05T23:00:00Z"),
      windowEnd: new Date("2026-10-06T00:00:00Z"),
    };
    const out = assignJobs([outOfWindow], techs);
    expect(out[0].employeeId).toBeNull();
  });

  it("respects tech shift capacity", () => {
    // 10 jobs × 60 min = 600 min > 9-6 shift (540 min).
    const jobs = Array.from({ length: 10 }, (_, i) => ({ ...jobHvac, jobId: `j-${i}` }));
    const out = assignJobs(jobs, techs);
    const assigned = out.filter((o) => o.employeeId).length;
    expect(assigned).toBeLessThanOrEqual(9);
  });

  it("prefers a tech whose window fully contains the job window", () => {
    // narrowTech's window (10:15-10:45) overlaps the 10-11 job but does
    // NOT contain it — wideTech's 9-6 shift does. Only wide gets the
    // +100 full-contain bonus and wins.
    const wideTech = { ...techs[0], employeeId: "e-wide", employeeName: "Wide" };
    const narrowTech = {
      ...techs[0],
      employeeId: "e-narrow",
      employeeName: "Narrow",
      windowStart: new Date("2026-10-05T10:15:00Z"),
      windowEnd: new Date("2026-10-05T10:45:00Z"),
    };
    const out = assignJobs([{ ...jobPlumbing }], [narrowTech, wideTech]);
    expect(out[0].employeeId).toBe("e-wide");
  });
});
