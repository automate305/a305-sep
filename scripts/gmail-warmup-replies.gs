// Seed-inbox auto-reply for OUTBOX warmup mail. Paste into script.google.com while
// signed in as ONE seed Gmail account (never the Workspace account), then:
//   1. Run previewWarmupReplies and read the log. It sends nothing.
//   2. Run installWarmupReplyTrigger once. It checks every 15 minutes from then on.
// It only answers mail from the senders below and never touches anything else.

var WARMUP_REPLY_CONFIG = {
  senders: ['hello@automate305.com', 'info@automate305.com'],
  replyChance: 0.6,
  minDelayMinutes: 10,
  maxDelayMinutes: 90,
  maxRepliesPerDay: 3,
  activeFromHour: 7,
  activeUntilHour: 22,
  lookbackDays: 2,
  maxHandledIds: 300,
  replies: [
    'Great, thanks.',
    'Got it, thanks.',
    'Received, thank you.',
    'Thanks, this came through.',
    'Looks good on my end, thanks.',
    'All set here, thank you.',
    'Thanks for the note.',
    'Came through fine, thanks.',
    'Got this, thanks.',
    'Perfect, thank you.'
  ]
};

function fnv1a_(text) {
  var hash = 0x811c9dc5;
  for (var i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function unit_(text) {
  return fnv1a_(text) / 4294967296;
}

function decideWarmupReply(messageId, config) {
  config = config || WARMUP_REPLY_CONFIG;
  var span = config.maxDelayMinutes - config.minDelayMinutes;
  return {
    reply: unit_(messageId + ':reply') < config.replyChance,
    delayMinutes: config.minDelayMinutes + Math.floor(unit_(messageId + ':delay') * (span + 1)),
    text: config.replies[Math.floor(unit_(messageId + ':text') * config.replies.length)]
  };
}

function addressOf_(header) {
  var text = String(header || '');
  var match = text.match(/<([^>]+)>/);
  return (match ? match[1] : text).trim().toLowerCase();
}

function readHandledIds_(props) {
  try {
    var parsed = JSON.parse(props.getProperty('handledIds') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function runWarmupReplies_(dryRun, now) {
  var config = WARMUP_REPLY_CONFIG;
  now = now || new Date();
  var outcome = { replied: 0, skipped: 0, waiting: 0, outsideHours: false, dryRun: !!dryRun, log: [] };
  var hour = now.getHours();
  if (hour < config.activeFromHour || hour >= config.activeUntilHour) {
    outcome.outsideHours = true;
    return outcome;
  }

  var me = addressOf_(Session.getActiveUser().getEmail());
  var props = PropertiesService.getScriptProperties();
  var handled = readHandledIds_(props);
  var today = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var sentToday = props.getProperty('replyDay') === today ? Number(props.getProperty('replyCount') || 0) : 0;
  var query = 'from:(' + config.senders.join(' OR ') + ') in:anywhere newer_than:' + config.lookbackDays + 'd';
  var threads = GmailApp.search(query, 0, 50);

  for (var t = 0; t < threads.length; t++) {
    var thread = threads[t];
    var messages = thread.getMessages();
    var lastIndex = -1;
    for (var m = 0; m < messages.length; m++) {
      if (config.senders.indexOf(addressOf_(messages[m].getFrom())) !== -1) lastIndex = m;
    }
    if (lastIndex === -1) continue;

    var target = messages[lastIndex];
    var id = target.getId();
    if (handled.indexOf(id) !== -1) continue;

    try {
      if (!dryRun && thread.isInSpam()) thread.moveToInbox();
    } catch (error) {
      outcome.log.push('could not move ' + id + ' out of spam');
    }

    var answered = false;
    for (var a = lastIndex + 1; a < messages.length; a++) {
      if (addressOf_(messages[a].getFrom()) === me) answered = true;
    }
    if (answered) {
      handled.push(id);
      outcome.skipped++;
      outcome.log.push(id + ': already answered');
      continue;
    }

    var decision = decideWarmupReply(id, config);
    var ageMinutes = (now.getTime() - target.getDate().getTime()) / 60000;
    if (ageMinutes < decision.delayMinutes) {
      outcome.waiting++;
      outcome.log.push(id + ': waiting, reply due in ' + Math.ceil(decision.delayMinutes - ageMinutes) + ' min');
      continue;
    }
    if (!decision.reply) {
      handled.push(id);
      outcome.skipped++;
      outcome.log.push(id + ': chosen not to reply');
      continue;
    }
    if (sentToday >= config.maxRepliesPerDay) {
      outcome.waiting++;
      outcome.log.push(id + ': daily limit reached');
      continue;
    }

    if (!dryRun) {
      thread.reply(decision.text);
      sentToday++;
      handled.push(id);
    }
    outcome.replied++;
    outcome.log.push(id + ': ' + (dryRun ? 'would reply "' : 'replied "') + decision.text + '"');
  }

  if (!dryRun) {
    props.setProperty('handledIds', JSON.stringify(handled.slice(-config.maxHandledIds)));
    props.setProperty('replyDay', today);
    props.setProperty('replyCount', String(sentToday));
  }
  return outcome;
}

function processWarmupReplies() {
  var outcome = runWarmupReplies_(false);
  Logger.log(JSON.stringify(outcome));
  return outcome;
}

function previewWarmupReplies() {
  var outcome = runWarmupReplies_(true);
  Logger.log(JSON.stringify(outcome, null, 2));
  return outcome;
}

function installWarmupReplyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processWarmupReplies') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('processWarmupReplies').timeBased().everyMinutes(15).create();
}
