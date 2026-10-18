// Unit tests for editorial routes — EditorialNote CRUD + unified calendar
// feed + convert-to-doc. Prisma + service-auth mocked at module boundary.

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────
const prismaMock = {
  editorialNote: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  campaign: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  broadcast: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  socialPost: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  whatsappMessage: {
    findMany: vi.fn(),
  },
  webinarEvent: {
    findMany: vi.fn(),
  },
};

vi.mock("@lumaara/db", () => ({
  prisma: prismaMock,
}));

vi.mock("@lumaara/service-auth", () => {
  const pass = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { auth: { tenantId: string; userId: string } }).auth = {
      tenantId: "tenant-A",
      userId: "user-U",
    };
    next();
  };
  return {
    perms: () => ({
      read: pass,
      write: pass,
      create: pass,
      delete: pass,
      submit: pass,
      cancel: pass,
    }),
  };
});

async function buildApp() {
  const { editorialRouter } = await import("./editorial");
  const app = express();
  app.use(express.json());
  app.use("/editorial", editorialRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults so calendar tests that don't override a source get [].
  prismaMock.editorialNote.findMany.mockResolvedValue([]);
  prismaMock.campaign.findMany.mockResolvedValue([]);
  prismaMock.broadcast.findMany.mockResolvedValue([]);
  prismaMock.socialPost.findMany.mockResolvedValue([]);
  prismaMock.whatsappMessage.findMany.mockResolvedValue([]);
  prismaMock.webinarEvent.findMany.mockResolvedValue([]);
});

function makeNote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "note-1",
    tenantId: "tenant-A",
    title: "Ship v1 blog",
    notes: "outline the launch narrative",
    plannedFor: new Date("2026-09-15T10:00:00Z"),
    channels: ["Email"],
    status: "Idea",
    ownerUserId: "user-U",
    colorTag: null,
    convertedToDoctype: null,
    convertedToDocId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── CRUD basics ───────────────────────────────────────────────────────
describe("editorial CRUD", () => {
  it("POST /notes creates a note with defaults", async () => {
    prismaMock.editorialNote.create.mockResolvedValueOnce(makeNote());
    const app = await buildApp();
    const res = await request(app).post("/editorial/notes").send({
      title: "Ship v1 blog",
      plannedFor: "2026-09-15T10:00:00.000Z",
      channels: ["Email"],
    });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Ship v1 blog");
    expect(prismaMock.editorialNote.create).toHaveBeenCalledOnce();
    const arg = prismaMock.editorialNote.create.mock.calls[0][0];
    expect(arg.data.tenantId).toBe("tenant-A");
    expect(arg.data.status).toBe("Idea");
  });

  it("POST /notes rejects an invalid channel", async () => {
    const app = await buildApp();
    const res = await request(app).post("/editorial/notes").send({
      title: "x",
      plannedFor: "2026-09-15T10:00:00.000Z",
      channels: ["Carrier Pigeon"],
    });
    expect(res.status).toBe(400);
    expect(prismaMock.editorialNote.create).not.toHaveBeenCalled();
  });

  it("PATCH /notes/:id updates status", async () => {
    prismaMock.editorialNote.findFirst.mockResolvedValueOnce(makeNote());
    prismaMock.editorialNote.update.mockResolvedValueOnce(
      makeNote({ status: "Planned" }),
    );
    const app = await buildApp();
    const res = await request(app)
      .patch("/editorial/notes/note-1")
      .send({ status: "Planned" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Planned");
  });

  it("DELETE /notes/:id 404s when the note belongs to another tenant", async () => {
    prismaMock.editorialNote.findFirst.mockResolvedValueOnce(null);
    const app = await buildApp();
    const res = await request(app).delete("/editorial/notes/note-1");
    expect(res.status).toBe(404);
    expect(prismaMock.editorialNote.delete).not.toHaveBeenCalled();
  });

  it("GET /notes filters by date range + status", async () => {
    prismaMock.editorialNote.findMany.mockResolvedValueOnce([makeNote()]);
    const app = await buildApp();
    const res = await request(app).get(
      "/editorial/notes?from=2026-09-01T00:00:00.000Z&to=2026-09-30T23:59:59.000Z&status=Idea",
    );
    expect(res.status).toBe(200);
    const arg = prismaMock.editorialNote.findMany.mock.calls[0][0];
    expect(arg.where.tenantId).toBe("tenant-A");
    expect(arg.where.status).toBe("Idea");
    expect(arg.where.plannedFor.gte).toBeInstanceOf(Date);
    expect(arg.where.plannedFor.lte).toBeInstanceOf(Date);
  });
});

// ── Calendar unified feed ─────────────────────────────────────────────
describe("GET /editorial/calendar", () => {
  it("requires start + end params (400 otherwise)", async () => {
    const app = await buildApp();
    const res = await request(app).get("/editorial/calendar");
    expect(res.status).toBe(400);
  });

  it("merges rows from all source types, sorted by plannedFor", async () => {
    prismaMock.editorialNote.findMany.mockResolvedValueOnce([
      makeNote({
        id: "n1",
        plannedFor: new Date("2026-09-05T09:00:00Z"),
      }),
    ]);
    prismaMock.campaign.findMany.mockResolvedValueOnce([
      {
        id: "c1",
        name: "Sept Newsletter",
        status: "Scheduled",
        channel: "Email",
        scheduledFor: new Date("2026-09-10T14:00:00Z"),
      },
    ]);
    prismaMock.broadcast.findMany.mockResolvedValueOnce([
      {
        id: "b1",
        name: "BR-0001",
        subject: "Company update",
        status: "Draft",
        scheduledFor: new Date("2026-09-01T10:00:00Z"),
      },
    ]);
    prismaMock.socialPost.findMany.mockResolvedValueOnce([
      {
        id: "s1",
        content: "Follow us for launch news",
        status: "Scheduled",
        scheduledFor: new Date("2026-09-12T08:00:00Z"),
      },
    ]);
    prismaMock.whatsappMessage.findMany.mockResolvedValueOnce([
      {
        id: "w1",
        body: "Reminder — event tomorrow",
        status: "Pending",
        scheduledFor: new Date("2026-09-14T09:00:00Z"),
        linkedDoctype: "Campaign",
        linkedId: "c1",
      },
    ]);
    prismaMock.webinarEvent.findMany.mockResolvedValueOnce([
      {
        id: "wb1",
        name: "How we ship",
        status: "Scheduled",
        startAt: new Date("2026-09-20T15:00:00Z"),
      },
    ]);

    const app = await buildApp();
    const res = await request(app).get(
      "/editorial/calendar?start=2026-09-01T00:00:00.000Z&end=2026-09-30T23:59:59.000Z",
    );
    expect(res.status).toBe(200);
    const items = res.body as Array<{ id: string; kind: string; plannedFor: string }>;
    expect(items).toHaveLength(6);
    const kinds = items.map((i) => i.kind).sort();
    expect(kinds).toEqual(
      ["broadcast", "campaign", "note", "social", "webinar", "whatsapp"].sort(),
    );
    // Sorted ascending by plannedFor.
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1].plannedFor <= items[i].plannedFor).toBe(true);
    }
  });

  it("degrades gracefully when one source throws (returns items from healthy sources)", async () => {
    prismaMock.editorialNote.findMany.mockResolvedValueOnce([
      makeNote({ id: "n1" }),
    ]);
    prismaMock.campaign.findMany.mockRejectedValueOnce(new Error("boom"));
    const app = await buildApp();
    const res = await request(app).get(
      "/editorial/calendar?start=2026-09-01T00:00:00.000Z&end=2026-09-30T23:59:59.000Z",
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].kind).toBe("note");
  });
});

// ── Convert-to-doc ────────────────────────────────────────────────────
describe("POST /notes/:id/convert", () => {
  it("creates a Campaign and stamps the note as Done + convertedToDoctype/DocId", async () => {
    prismaMock.editorialNote.findFirst.mockResolvedValueOnce(makeNote());
    prismaMock.campaign.create.mockResolvedValueOnce({
      id: "camp-42",
      tenantId: "tenant-A",
      name: "Ship v1 blog",
    });
    prismaMock.editorialNote.update.mockResolvedValueOnce(
      makeNote({
        status: "Done",
        convertedToDoctype: "Campaign",
        convertedToDocId: "camp-42",
      }),
    );
    const app = await buildApp();
    const res = await request(app)
      .post("/editorial/notes/note-1/convert")
      .send({ doctype: "Campaign" });
    expect(res.status).toBe(200);
    expect(prismaMock.campaign.create).toHaveBeenCalledOnce();
    expect(res.body.doc.id).toBe("camp-42");
    expect(res.body.note.status).toBe("Done");
    expect(res.body.note.convertedToDoctype).toBe("Campaign");
    expect(res.body.note.convertedToDocId).toBe("camp-42");
  });

  it("409s when the note has already been converted", async () => {
    prismaMock.editorialNote.findFirst.mockResolvedValueOnce(
      makeNote({
        convertedToDoctype: "Campaign",
        convertedToDocId: "camp-99",
      }),
    );
    const app = await buildApp();
    const res = await request(app)
      .post("/editorial/notes/note-1/convert")
      .send({ doctype: "Campaign" });
    expect(res.status).toBe(409);
    expect(prismaMock.campaign.create).not.toHaveBeenCalled();
  });
});
