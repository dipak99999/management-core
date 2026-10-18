import { describe, expect, it } from "vitest";
import { cosineSimilarity, StubEmbeddingProvider, contentHash } from "./embedding-provider";
import { buildContent, scoreEmbeddings } from "./semantic-search";

describe("cosineSimilarity", () => {
  it("identical vectors → 1", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });
  it("orthogonal → 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it("opposite → -1", () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 6);
  });
  it("empty / mismatched → 0", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
  });
});

describe("StubEmbeddingProvider", () => {
  it("emits 8-dim vector deterministically", async () => {
    const p = new StubEmbeddingProvider();
    const a = await p.embed("hello world");
    const b = await p.embed("hello world");
    expect(a.vector).toEqual(b.vector);
    expect(a.vector).toHaveLength(8);
  });

  it("different texts → different vectors", async () => {
    const p = new StubEmbeddingProvider();
    const a = (await p.embed("A")).vector;
    const b = (await p.embed("B")).vector;
    expect(a).not.toEqual(b);
  });
});

describe("contentHash", () => {
  it("stable + collision-free for different inputs", () => {
    expect(contentHash("x")).toBe(contentHash("x"));
    expect(contentHash("x")).not.toBe(contentHash("y"));
  });
});

describe("scoreEmbeddings", () => {
  const rows = [
    { doctype: "Customer", docId: "1", title: "Acme Corp",   content: "Acme Corp new york enterprise",  vector: [1, 0, 0] },
    { doctype: "Customer", docId: "2", title: "Beta Inc",    content: "Beta Inc san francisco startup", vector: [0, 1, 0] },
    { doctype: "Lead",     docId: "3", title: "Gamma sales", content: "gamma seattle",                  vector: [0, 0.5, 0.5] },
  ];

  it("ranks by cosine similarity to query vector", () => {
    const hits = scoreEmbeddings(rows, {
      queryVector: [0, 1, 0],
      queryText: "",
    });
    expect(hits[0].docId).toBe("2"); // best cosine match
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it("boosts keyword hits", () => {
    // Query vector aligns with row 1, but keyword "san francisco" boosts row 2.
    const hits = scoreEmbeddings(rows, {
      queryVector: [1, 0, 0],
      queryText: "san francisco",
    });
    const row1 = hits.find((h) => h.docId === "1");
    const row2 = hits.find((h) => h.docId === "2");
    // Row 1 still wins on vector, but row 2's keyword score should be > 0.
    expect(row1!.vectorScore).toBe(1);
    expect(row2!.keywordScore).toBeGreaterThan(0);
  });

  it("filters by doctype", () => {
    const hits = scoreEmbeddings(rows, {
      queryVector: [0, 1, 0],
      queryText: "",
      doctypes: ["Lead"],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].doctype).toBe("Lead");
  });

  it("respects limit + minScore", () => {
    const hits = scoreEmbeddings(rows, {
      queryVector: [0, 1, 0],
      queryText: "",
      limit: 1,
      minScore: 0.5,
    });
    expect(hits).toHaveLength(1);
  });
});

describe("buildContent", () => {
  it("uses Customer builder", () => {
    const r = buildContent("Customer", {
      customerName: "Acme",
      email: "a@b.com",
      city: "Bangalore",
      gstin: "29ABCDE",
    });
    expect(r.title).toBe("Acme");
    expect(r.content).toContain("a@b.com");
    expect(r.content).toContain("Bangalore");
  });

  it("falls back to generic for unknown doctype", () => {
    const r = buildContent("UnknownThing", { name: "X", foo: 1 });
    expect(r.title).toBe("X");
    expect(r.content).toContain("foo");
  });
});
