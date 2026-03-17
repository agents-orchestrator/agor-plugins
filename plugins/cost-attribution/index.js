function safeGet(obj) { for (var i = 1; i < arguments.length; i++) try { obj = obj[arguments[i]]; } catch(e) { return undefined; } return obj; }
function safeMsg(msg) { return { type: safeGet(msg, 'type') || 'unknown', content: safeGet(msg, 'content') || '', toolCall: safeGet(msg, 'tool_call') || null, role: safeGet(msg, 'role') || 'unknown' }; }

var PREFIX = '[COST:v1:';
var LRU_CAP = 100;
var COST_PER_1K = 0.003;
var tags = new Map();
var activeTag = null;

function taskKey(tag) { return PREFIX + tag + ']'; }
function isOurs(t) { return t.title && t.title.startsWith(PREFIX) && t.status !== 'done'; }
function parseTag(title) { return title.slice(PREFIX.length, -1); }
function estimateTokens(content) { return Math.ceil((content || '').length / 4); }

function enforceLru() {
  if (tags.size <= LRU_CAP) return;
  var entries = Array.from(tags.entries());
  entries.sort(function(a, b) { return a[1].totalMessages - b[1].totalMessages; });
  while (tags.size > LRU_CAP) {
    var oldest = entries.shift();
    if (oldest) {
      tags.delete(oldest[0]);
      agor.tasks.updateStatus(oldest[1]._taskId, 'done');
    }
  }
}

async function loadAll() {
  var tasks = await agor.tasks.list();
  tasks.filter(isOurs).forEach(function(t) {
    try {
      var data = JSON.parse(t.description);
      data._taskId = t.id;
      tags.set(parseTag(t.title), data);
    } catch(e) {}
  });
}

async function persistTag(name) {
  var entry = tags.get(name);
  if (!entry) return;
  var data = { tag: entry.tag, totalMessages: entry.totalMessages, estimatedTokens: entry.estimatedTokens, estimatedCostUsd: entry.estimatedCostUsd, sessions: entry.sessions };
  if (entry._taskId) {
    await agor.tasks.updateStatus(entry._taskId, 'todo');
  } else {
    var task = await agor.tasks.create(taskKey(name), JSON.stringify(data));
    entry._taskId = task.id;
  }
}

function tagSession(tagName) {
  if (!tagName) return agor.notifications.send('Cost Attribution', 'Usage: Cost: Tag Session [ticket-id]');
  activeTag = tagName;
  if (!tags.has(tagName)) {
    tags.set(tagName, { tag: tagName, totalMessages: 0, estimatedTokens: 0, estimatedCostUsd: 0, sessions: 1 });
    enforceLru();
  } else {
    tags.get(tagName).sessions++;
  }
  agor.notifications.send('Cost Attribution', 'Session tagged: ' + tagName);
  agor.events.emit('cost.tagged', { tag: tagName });
}

function reportAll() {
  if (tags.size === 0) return agor.notifications.send('Cost Attribution', 'No cost records');
  var lines = [];
  tags.forEach(function(v, k) {
    lines.push(k + ': $' + v.estimatedCostUsd.toFixed(4) + ' (' + v.totalMessages + ' msgs, ' + v.sessions + ' sessions)');
  });
  agor.notifications.send('Cost Attribution', lines.join('\n'));
}

function reportOne(tagName) {
  if (!tagName) return reportAll();
  var entry = tags.get(tagName);
  if (!entry) return agor.notifications.send('Cost Attribution', 'Tag not found: ' + tagName);
  agor.notifications.send('Cost Attribution',
    'Tag: ' + entry.tag + '\n' +
    'Messages: ' + entry.totalMessages + '\n' +
    'Est. tokens: ' + entry.estimatedTokens + '\n' +
    'Est. cost: $' + entry.estimatedCostUsd.toFixed(4) + '\n' +
    'Sessions: ' + entry.sessions
  );
}

async function purgeAll() {
  var count = 0;
  for (var entry of tags.values()) {
    if (entry._taskId) await agor.tasks.updateStatus(entry._taskId, 'done');
    count++;
  }
  tags.clear();
  activeTag = null;
  agor.notifications.send('Cost Attribution', 'Purged ' + count + ' cost records');
}

loadAll().then(function() {
  agor.palette.registerCommand('Cost: Tag Session', function(args) { tagSession(args); });
  agor.palette.registerCommand('Cost: Report', function(args) { reportOne(args); });
  agor.palette.registerCommand('Cost: Purge All', purgeAll);

  agor.messages.onMessage(function(msg) {
    if (!activeTag) return;
    var safe = safeMsg(msg);
    var entry = tags.get(activeTag);
    if (!entry) return;
    var tokens = estimateTokens(safe.content);
    entry.totalMessages++;
    entry.estimatedTokens += tokens;
    entry.estimatedCostUsd = (entry.estimatedTokens / 1000) * COST_PER_1K;
    persistTag(activeTag);
  });
});
