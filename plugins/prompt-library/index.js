function safeGet(obj) { for (var i = 1; i < arguments.length; i++) try { obj = obj[arguments[i]]; } catch(e) { return undefined; } return obj; }
function safeMsg(msg) { return { type: safeGet(msg, 'type') || 'unknown', content: safeGet(msg, 'content') || '', toolCall: safeGet(msg, 'tool_call') || null, role: safeGet(msg, 'role') || 'unknown' }; }

const PREFIX = '[PROMPT:v1:';
const LRU_CAP = 100;
const prompts = new Map();
let lastUserMessage = '';

function taskKey(name) { return PREFIX + name + ']'; }
function isOurs(t) { return t.title && t.title.startsWith(PREFIX) && t.status !== 'done'; }
function parseName(title) { return title.slice(PREFIX.length, -1); }

function serialize(entry) { return JSON.stringify(entry); }
function deserialize(desc) { try { return JSON.parse(desc); } catch(e) { return null; } }

function interpolate(template) {
  var now = new Date().toISOString().slice(0, 10);
  return template
    .replace(/\{\{date\}\}/g, now)
    .replace(/\{\{file\}\}/g, '<current-file>')
    .replace(/\{\{project\}\}/g, '<current-project>');
}

function enforceLru() {
  if (prompts.size <= LRU_CAP) return;
  var entries = Array.from(prompts.entries());
  entries.sort(function(a, b) { return (a[1].usageCount || 0) - (b[1].usageCount || 0); });
  while (prompts.size > LRU_CAP) {
    var oldest = entries.shift();
    if (oldest) {
      prompts.delete(oldest[0]);
      agor.tasks.updateStatus(oldest[1]._taskId, 'done');
    }
  }
}

async function loadAll() {
  var tasks = await agor.tasks.list();
  tasks.filter(isOurs).forEach(function(t) {
    var data = deserialize(t.description);
    if (data) {
      data._taskId = t.id;
      prompts.set(parseName(t.title), data);
    }
  });
}

async function savePrompt(name, template, tags) {
  var entry = { template: template, tags: tags || [], usageCount: 0, createdAt: new Date().toISOString() };
  var task = await agor.tasks.create(taskKey(name), serialize(entry));
  entry._taskId = task.id;
  prompts.set(name, entry);
  enforceLru();
  agor.notifications.send('Prompt Library', 'Saved prompt: ' + name);
}

async function deletePrompt(name) {
  var entry = prompts.get(name);
  if (!entry) return agor.notifications.send('Prompt Library', 'Prompt not found: ' + name);
  await agor.tasks.updateStatus(entry._taskId, 'done');
  prompts.delete(name);
  agor.notifications.send('Prompt Library', 'Deleted prompt: ' + name);
}

async function purgeAll() {
  var count = 0;
  for (var entry of prompts.values()) {
    await agor.tasks.updateStatus(entry._taskId, 'done');
    count++;
  }
  prompts.clear();
  agor.notifications.send('Prompt Library', 'Purged ' + count + ' prompts');
}

function listPrompts() {
  if (prompts.size === 0) return agor.notifications.send('Prompt Library', 'No saved prompts');
  var lines = [];
  prompts.forEach(function(v, k) {
    lines.push(k + ' [' + (v.tags || []).join(', ') + '] (used ' + (v.usageCount || 0) + 'x)');
  });
  agor.notifications.send('Prompt Library', lines.join('\n'));
}

function searchPrompts(term) {
  var lower = term.toLowerCase();
  var matches = [];
  prompts.forEach(function(v, k) {
    var nameMatch = k.toLowerCase().indexOf(lower) !== -1;
    var tagMatch = (v.tags || []).some(function(t) { return t.toLowerCase().indexOf(lower) !== -1; });
    if (nameMatch || tagMatch) matches.push(k + ' [' + (v.tags || []).join(', ') + ']');
  });
  if (matches.length === 0) return agor.notifications.send('Prompt Library', 'No prompts matching: ' + term);
  agor.notifications.send('Prompt Library', 'Found ' + matches.length + ':\n' + matches.join('\n'));
}

function usePrompt(name) {
  var entry = prompts.get(name);
  if (!entry) return agor.notifications.send('Prompt Library', 'Prompt not found: ' + name);
  entry.usageCount = (entry.usageCount || 0) + 1;
  var expanded = interpolate(entry.template);
  agor.notifications.send('Prompt Library', 'Template:\n' + expanded);
  return expanded;
}

loadAll().then(function() {
  agor.palette.registerCommand('Prompts: Save', function() {
    if (!lastUserMessage) return agor.notifications.send('Prompt Library', 'No recent user message to save');
    var name = 'prompt-' + Date.now();
    savePrompt(name, lastUserMessage, []);
  });

  agor.palette.registerCommand('Prompts: List', listPrompts);

  agor.palette.registerCommand('Prompts: Search', function(args) {
    if (!args) return agor.notifications.send('Prompt Library', 'Usage: Prompts: Search [term]');
    searchPrompts(args);
  });

  agor.palette.registerCommand('Prompts: Use', function(args) {
    if (!args) return agor.notifications.send('Prompt Library', 'Usage: Prompts: Use [name]');
    usePrompt(args);
  });

  agor.palette.registerCommand('Prompts: Delete', function(args) {
    if (!args) return agor.notifications.send('Prompt Library', 'Usage: Prompts: Delete [name]');
    deletePrompt(args);
  });

  agor.palette.registerCommand('Prompts: Purge All', purgeAll);

  agor.messages.onMessage(function(msg) {
    var safe = safeMsg(msg);
    if (safe.role === 'user' && safe.content) lastUserMessage = safe.content;
  });
});
