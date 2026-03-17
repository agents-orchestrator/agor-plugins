function safeGet(obj) { for (var i = 1; i < arguments.length; i++) try { obj = obj[arguments[i]]; } catch(e) { return undefined; } return obj; }
function safeMsg(msg) { return { type: safeGet(msg, 'type') || 'unknown', content: safeGet(msg, 'content') || '', toolCall: safeGet(msg, 'tool_call') || null, role: safeGet(msg, 'role') || 'unknown' }; }

var PREFIX = '[PLAYBOOK:v1:';
var LRU_CAP = 100;
var playbooks = new Map();

function taskKey(name) { return PREFIX + name + ']'; }
function isOurs(t) { return t.title && t.title.startsWith(PREFIX) && t.status !== 'done'; }
function parseName(title) { return title.slice(PREFIX.length, -1); }

function enforceLru() {
  if (playbooks.size <= LRU_CAP) return;
  var entries = Array.from(playbooks.entries());
  entries.sort(function(a, b) { return new Date(a[1].createdAt) - new Date(b[1].createdAt); });
  while (playbooks.size > LRU_CAP) {
    var oldest = entries.shift();
    if (oldest) {
      playbooks.delete(oldest[0]);
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
      playbooks.set(parseName(t.title), data);
    } catch(e) {}
  });
}

async function createPlaybook(args) {
  if (!args) return agor.notifications.send('Agent Playbooks', 'Usage: Playbooks: Create [name]');
  var parts = args.split(/\s+/);
  var name = parts[0];
  if (playbooks.has(name)) return agor.notifications.send('Agent Playbooks', 'Playbook already exists: ' + name);

  var entry = {
    name: name,
    systemPrompt: 'You are a helpful assistant.',
    model: 'claude-sonnet-4-20250514',
    provider: 'claude',
    permissionMode: 'bypassPermissions',
    tags: parts.slice(1),
    description: 'Playbook: ' + name,
    createdAt: new Date().toISOString()
  };

  var task = await agor.tasks.create(taskKey(name), JSON.stringify(entry));
  entry._taskId = task.id;
  playbooks.set(name, entry);
  enforceLru();
  agor.notifications.send('Agent Playbooks', 'Created playbook: ' + name + '\nModel: ' + entry.model + '\nProvider: ' + entry.provider);
}

function listPlaybooks() {
  if (playbooks.size === 0) return agor.notifications.send('Agent Playbooks', 'No saved playbooks');
  var lines = [];
  playbooks.forEach(function(v, k) {
    lines.push(k + ' (' + v.provider + '/' + v.model + ') — ' + (v.description || ''));
  });
  agor.notifications.send('Agent Playbooks', lines.join('\n'));
}

function viewPlaybook(name) {
  if (!name) return agor.notifications.send('Agent Playbooks', 'Usage: Playbooks: View [name]');
  var entry = playbooks.get(name);
  if (!entry) return agor.notifications.send('Agent Playbooks', 'Playbook not found: ' + name);
  agor.notifications.send('Agent Playbooks',
    'Name: ' + entry.name + '\n' +
    'Provider: ' + entry.provider + '\n' +
    'Model: ' + entry.model + '\n' +
    'Permission: ' + entry.permissionMode + '\n' +
    'Tags: ' + (entry.tags || []).join(', ') + '\n' +
    'Prompt: ' + (entry.systemPrompt || '').slice(0, 200) + '\n' +
    'Created: ' + entry.createdAt
  );
}

async function deletePlaybook(name) {
  if (!name) return agor.notifications.send('Agent Playbooks', 'Usage: Playbooks: Delete [name]');
  var entry = playbooks.get(name);
  if (!entry) return agor.notifications.send('Agent Playbooks', 'Playbook not found: ' + name);
  await agor.tasks.updateStatus(entry._taskId, 'done');
  playbooks.delete(name);
  agor.notifications.send('Agent Playbooks', 'Deleted playbook: ' + name);
}

async function purgeAll() {
  var count = 0;
  for (var entry of playbooks.values()) {
    if (entry._taskId) await agor.tasks.updateStatus(entry._taskId, 'done');
    count++;
  }
  playbooks.clear();
  agor.notifications.send('Agent Playbooks', 'Purged ' + count + ' playbooks');
}

function exportPlaybook(name) {
  if (!name) return agor.notifications.send('Agent Playbooks', 'Usage: Playbooks: Export [name]');
  var entry = playbooks.get(name);
  if (!entry) return agor.notifications.send('Agent Playbooks', 'Playbook not found: ' + name);
  var exportData = { name: entry.name, systemPrompt: entry.systemPrompt, model: entry.model, provider: entry.provider, permissionMode: entry.permissionMode, tags: entry.tags, description: entry.description };
  agor.events.emit('playbook.exported', exportData);
  agor.notifications.send('Agent Playbooks', 'Exported playbook: ' + name + '\n' + JSON.stringify(exportData, null, 2));
}

loadAll().then(function() {
  agor.palette.registerCommand('Playbooks: Create', function(args) { createPlaybook(args); });
  agor.palette.registerCommand('Playbooks: List', listPlaybooks);
  agor.palette.registerCommand('Playbooks: View', function(args) { viewPlaybook(args); });
  agor.palette.registerCommand('Playbooks: Delete', function(args) { deletePlaybook(args); });
  agor.palette.registerCommand('Playbooks: Export', function(args) { exportPlaybook(args); });
  agor.palette.registerCommand('Playbooks: Purge All', purgeAll);
});
