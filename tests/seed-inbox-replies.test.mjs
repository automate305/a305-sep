import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const SOURCE = await readFile(new URL("../scripts/gmail-warmup-replies.gs", import.meta.url), "utf8");
const ME = "seed@gmail.com";
const MIN = 60_000;

function localTime(day, hour) {
  return new Date(2026, 10, day, hour, 0, 0);
}

function message(id, from, sentAt) {
  return { getDate: () => sentAt, getFrom: () => from, getId: () => id };
}

function thread(messages, { spam = false } = {}) {
  const state = { moved: false, replies: [] };
  return {
    getMessages: () => messages,
    isInSpam: () => spam,
    moveToInbox: () => { state.moved = true; },
    reply: (text) => { state.replies.push(text); },
    state,
  };
}

function load({ threads = [], triggers = [] } = {}) {
  const store = new Map();
  const created = [];
  const deleted = [];
  const queries = [];
  const sandbox = {
    GmailApp: { search: (query) => { queries.push(query); return threads; } },
    JSON, Logger: { log() {} }, Math, Number, String, Array,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => (store.has(key) ? store.get(key) : null),
        setProperty: (key, value) => { store.set(key, value); },
      }),
    },
    ScriptApp: {
      deleteTrigger: (trigger) => { deleted.push(trigger); },
      getProjectTriggers: () => triggers,
      newTrigger: (name) => ({
        timeBased: () => ({ everyMinutes: (minutes) => ({ create: () => { created.push({ minutes, name }); } }) }),
      }),
    },
    Session: { getActiveUser: () => ({ getEmail: () => ME }), getScriptTimeZone: () => "America/New_York" },
    Utilities: {
      formatDate: (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return { created, deleted, queries, sandbox, store };
}

function findIds(sandbox, predicate, count) {
  const found = [];
  for (let index = 0; found.length < count && index < 100_000; index += 1) {
    const id = `msg-${index}`;
    if (predicate(sandbox.decideWarmupReply(id))) found.push(id);
  }
  return found;
}

test("a reply decision is stable for a message and spread across the configured range", () => {
  const { sandbox } = load();
  const first = sandbox.decideWarmupReply("abc123");
  assert.deepEqual(first, sandbox.decideWarmupReply("abc123"));

  const ids = Array.from({ length: 5000 }, (_, index) => `id-${index}-${(index * 7919) % 10007}`);
  const decisions = ids.map((id) => sandbox.decideWarmupReply(id));
  const replyRate = decisions.filter((decision) => decision.reply).length / decisions.length;
  const delays = decisions.map((decision) => decision.delayMinutes);

  assert.ok(replyRate > 0.55 && replyRate < 0.65, `reply rate ${replyRate} should be near 60%`);
  assert.equal(Math.min(...delays), 10);
  assert.equal(Math.max(...delays), 90);
  assert.ok(new Set(decisions.map((decision) => decision.text)).size >= 8, "reply wording should vary");
});

test("every reply is a short plain sentence with no em dash, link or signature", () => {
  const { sandbox } = load();
  for (const text of sandbox.WARMUP_REPLY_CONFIG.replies) {
    assert.match(text, /^[A-Z]/, `"${text}" must start with a capital`);
    assert.doesNotMatch(text, /[—–]/, `"${text}" must not contain a dash character`);
    assert.doesNotMatch(text, /https?:|www\.|@/i, `"${text}" must not contain a link or address`);
    assert.ok(text.length <= 40, `"${text}" should be short`);
  }
});

test("it searches only for mail from hello@ and info@", () => {
  const env = load();
  env.sandbox.runWarmupReplies_(true, localTime(9, 10));

  assert.match(env.queries[0], /hello@automate305\.com/);
  assert.match(env.queries[0], /info@automate305\.com/);
  assert.doesNotMatch(env.queries[0], /aestheticdevicepro|cam@/);
});

test("it replies once the delay has passed and not before", () => {
  const probe = load();
  const [id] = findIds(probe.sandbox, (decision) => decision.reply, 1);
  const { delayMinutes } = probe.sandbox.decideWarmupReply(id);
  const sentAt = localTime(9, 8);

  const early = thread([message(id, '"Camilo" <hello@automate305.com>', sentAt)]);
  const earlyEnv = load({ threads: [early] });
  const waiting = earlyEnv.sandbox.runWarmupReplies_(false, new Date(sentAt.getTime() + (delayMinutes - 1) * MIN));
  assert.equal(early.state.replies.length, 0);
  assert.equal(waiting.waiting, 1);

  const due = thread([message(id, '"Camilo" <hello@automate305.com>', sentAt)]);
  const dueEnv = load({ threads: [due] });
  const done = dueEnv.sandbox.runWarmupReplies_(false, new Date(sentAt.getTime() + (delayMinutes + 1) * MIN));
  assert.equal(done.replied, 1);
  assert.equal(due.state.replies.length, 1);
  assert.equal(due.state.replies[0], probe.sandbox.decideWarmupReply(id).text);
});

test("a message chosen for no reply never gets one and is not reconsidered", () => {
  const probe = load();
  const [id] = findIds(probe.sandbox, (decision) => !decision.reply, 1);
  const sentAt = localTime(9, 8);
  const quiet = thread([message(id, "info@automate305.com", sentAt)]);
  const env = load({ threads: [quiet] });
  const later = new Date(sentAt.getTime() + 200 * MIN);

  const first = env.sandbox.runWarmupReplies_(false, later);
  const second = env.sandbox.runWarmupReplies_(false, later);

  assert.equal(quiet.state.replies.length, 0);
  assert.equal(first.skipped, 1);
  assert.equal(second.skipped, 0, "already handled messages are not looked at again");
});

test("it never answers a message you already answered, but does answer a newer one in the same thread", () => {
  const probe = load();
  const [oldId, newId] = findIds(probe.sandbox, (decision) => decision.reply, 2);
  const sentAt = localTime(8, 8);
  const answeredByHand = thread([
    message(oldId, "hello@automate305.com", sentAt),
    message("my-reply", ME, new Date(sentAt.getTime() + 5 * MIN)),
  ]);
  const newerInSameThread = thread([
    message(oldId, "hello@automate305.com", sentAt),
    message("my-reply", ME, new Date(sentAt.getTime() + 5 * MIN)),
    message(newId, "hello@automate305.com", localTime(9, 8)),
  ]);
  const env = load({ threads: [answeredByHand, newerInSameThread] });

  env.sandbox.runWarmupReplies_(false, localTime(9, 20));

  assert.equal(answeredByHand.state.replies.length, 0);
  assert.equal(newerInSameThread.state.replies.length, 1);
});

test("it ignores mail that is not exactly from hello@ or info@", () => {
  const probe = load();
  const ids = findIds(probe.sandbox, (decision) => decision.reply, 3);
  const sentAt = localTime(9, 8);
  const lookalikes = [
    thread([message(ids[0], "hello@automate305.com.example.net", sentAt)]),
    thread([message(ids[1], '"Hello" <sales@automate305.com>', sentAt)]),
    thread([message(ids[2], "matt@aestheticdevicepro.com", sentAt)]),
  ];
  const env = load({ threads: lookalikes });

  env.sandbox.runWarmupReplies_(false, localTime(9, 20));

  for (const item of lookalikes) assert.equal(item.state.replies.length, 0);
});

test("it sends at most three replies a day and resumes the next day", () => {
  const probe = load();
  const ids = findIds(probe.sandbox, (decision) => decision.reply && decision.delayMinutes <= 30, 5);
  const sentAt = localTime(9, 8);
  const threads = ids.map((id) => thread([message(id, "hello@automate305.com", sentAt)]));
  const env = load({ threads });

  const today = env.sandbox.runWarmupReplies_(false, localTime(9, 10));
  const sameDay = env.sandbox.runWarmupReplies_(false, localTime(9, 12));
  const nextDay = env.sandbox.runWarmupReplies_(false, localTime(10, 10));

  assert.equal(today.replied, 3);
  assert.equal(sameDay.replied, 0);
  assert.equal(nextDay.replied, 2);
  assert.equal(threads.reduce((sum, item) => sum + item.state.replies.length, 0), 5);
});

test("a preview sends nothing and remembers nothing", () => {
  const probe = load();
  const [id] = findIds(probe.sandbox, (decision) => decision.reply && decision.delayMinutes <= 30, 1);
  const item = thread([message(id, "hello@automate305.com", localTime(9, 8))], { spam: true });
  const env = load({ threads: [item] });

  const outcome = env.sandbox.runWarmupReplies_(true, localTime(9, 10));

  assert.equal(outcome.replied, 1);
  assert.equal(outcome.dryRun, true);
  assert.equal(item.state.replies.length, 0);
  assert.equal(item.state.moved, false);
  assert.equal(env.store.size, 0);
});

test("a warmup message found in spam is moved to the inbox", () => {
  const probe = load();
  const [id] = findIds(probe.sandbox, (decision) => decision.reply, 1);
  const item = thread([message(id, "info@automate305.com", localTime(9, 8))], { spam: true });
  const env = load({ threads: [item] });

  env.sandbox.runWarmupReplies_(false, localTime(9, 9));

  assert.equal(item.state.moved, true);
});

test("it does nothing outside waking hours", () => {
  const probe = load();
  const [id] = findIds(probe.sandbox, (decision) => decision.reply && decision.delayMinutes <= 30, 1);
  const item = thread([message(id, "hello@automate305.com", localTime(9, 1))]);
  const env = load({ threads: [item] });

  const night = env.sandbox.runWarmupReplies_(false, localTime(9, 3));

  assert.equal(night.outsideHours, true);
  assert.equal(item.state.replies.length, 0);
  assert.equal(env.queries.length, 0, "it should not even search at night");
});

test("installing the trigger twice leaves exactly one 15 minute trigger", () => {
  const stale = { getHandlerFunction: () => "processWarmupReplies" };
  const other = { getHandlerFunction: () => "somethingElse" };
  const env = load({ triggers: [stale, other] });

  env.sandbox.installWarmupReplyTrigger();

  assert.deepEqual(env.deleted, [stale]);
  assert.deepEqual(env.created, [{ minutes: 15, name: "processWarmupReplies" }]);
});

test("the script holds no credentials and only touches Gmail and its own settings", () => {
  assert.doesNotMatch(SOURCE, /password|app_pass|SMTP_|SUPABASE|api[_-]?key|Authorization/i);
  assert.doesNotMatch(SOURCE, /UrlFetchApp|MailApp\.sendEmail|GmailApp\.sendEmail|\.forward\(|\.deleteThread|moveToTrash|markSpam|moveToSpam/);
});
