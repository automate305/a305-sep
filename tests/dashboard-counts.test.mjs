import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { applyUncappedCounts, countAllRows, emptyCampaignCounts } from "../lib/services/dashboard-counts.js";

function metrics() {
  const empty = () => ({ active: 0, bounced: 0, held: 0, queued: 0, replied: 0, sentToday: 0 });
  return { aesthetic: empty(), all: empty(), hvac: empty() };
}

test("queue and hold totals use the exact counts, not a preview page", () => {
  const board = metrics();
  applyUncappedCounts(board, {
    holdCount: 337,
    holdCounts: { aesthetic: 200, hvac: 137, total: 337 },
    queueCount: 215,
    queueCounts: { aesthetic: 128, hvac: 87, total: 215 },
  });

  assert.equal(board.all.queued, 215);
  assert.equal(board.aesthetic.queued, 128);
  assert.equal(board.hvac.queued, 87);
  assert.equal(board.all.held, 337);
  assert.equal(board.aesthetic.held, 200);
  assert.equal(board.hvac.held, 137);
});

test("a zero count stays zero when the exact count is present", () => {
  const board = metrics();
  applyUncappedCounts(board, {
    holdCount: 0,
    holdCounts: emptyCampaignCounts(),
    queueCount: 0,
    queueCounts: emptyCampaignCounts(),
  });

  assert.equal(board.all.queued, 0);
  assert.equal(board.all.held, 0);
});

test("campaign paging continues past the old 50 and 20 row caps", async () => {
  const rows = [
    ...Array.from({ length: 128 }, () => ({ campaign: "aesthetic" })),
    ...Array.from({ length: 87 }, () => ({ campaign: "hvac" })),
  ];
  const pages = [];
  const counts = await countAllRows(async (from, to) => {
    pages.push([from, to]);
    return { data: rows.slice(from, to + 1), error: null };
  });

  assert.equal(counts.total, 215);
  assert.equal(counts.aesthetic, 128);
  assert.equal(counts.hvac, 87);
  assert.deepEqual(pages, [[0, 999]]);
});

test("campaign paging requests the next thousand when a page is full", async () => {
  const first = Array.from({ length: 1000 }, () => ({ campaign: "aesthetic" }));
  const second = Array.from({ length: 20 }, () => ({ campaign: "hvac" }));
  const counts = await countAllRows(async (from) => ({
    data: from === 0 ? first : second,
    error: null,
  }));

  assert.equal(counts.total, 1020);
  assert.equal(counts.aesthetic, 1000);
  assert.equal(counts.hvac, 20);
});

test("the dashboard wires those counts and keeps the preview lists capped", async () => {
  const source = await readFile(new URL("../lib/services/dashboard.ts", import.meta.url), "utf8");
  const component = await readFile(
    new URL("../components/dashboard/outreach-dashboard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /select\("\*", \{ count: "exact" \}\)\.limit\(50\)/);
  assert.match(source, /\.eq\("status", "held"\)\.limit\(20\)/);
  assert.match(source, /select\("id", \{ count: "exact", head: true \}\)[\s\S]*\.eq\("status", "held"\)/);
  assert.match(source, /applyUncappedCounts\(brandMetrics/);
  assert.match(source, /queueCount: queueResult\.count/);
  assert.match(source, /holdCount: holdCountResult\.count/);
  assert.doesNotMatch(source, /for \(const item of queue\) addMetric/);
  assert.doesNotMatch(source, /for \(const item of holdQueue\) addMetric/);
  assert.match(component, /selectedMetrics\.queued/);
  assert.match(component, /selectedMetrics\.held/);
  assert.doesNotMatch(component, /filteredQueue\.length\} due/);
  assert.doesNotMatch(component, /filteredHolds\.length\} held/);
});
