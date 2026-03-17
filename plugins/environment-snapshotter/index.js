function safeGet(obj) { for (var i = 1; i < arguments.length; i++) try { obj = obj[arguments[i]]; } catch(e) { return undefined; } return obj; }
function safeMsg(msg) { return { type: safeGet(msg, 'type') || 'unknown', content: safeGet(msg, 'content') || '', toolCall: safeGet(msg, 'tool_call') || null, role: safeGet(msg, 'role') || 'unknown' }; }

var snapshot = { cwd: null, model: null, provider: null, toolVersions: {}, startTime: Date.now(), messageCount: 0 };
var captured = false;
var messagesSeen = 0;
var lastSavedSnapshot = null;

function extractCwd(content) {
  if (!content) return null;
  var patterns = [/cwd[:\s]+([^\s,\n]+)/i, /directory[:\s]+([^\s,\n]+)/i, /working.?dir[:\s]+([^\s,\n]+)/i];
  for (var i = 0; i < patterns.length; i++) {
    var match = content.match(patterns[i]);
    if (match) return match[1];
  }
  return null;
}

function extractModel(content) {
  if (!content) return null;
  var match = content.match(/model[:\s]+"?([a-zA-Z0-9._-]+)"?/i);
  return match ? match[1] : null;
}

function extractProvider(content) {
  if (!content) return null;
  var providers = ['claude', 'codex', 'ollama', 'openai', 'anthropic'];
  var lower = content.toLowerCase();
  for (var i = 0; i < providers.length; i++) {
    if (lower.indexOf(providers[i]) !== -1) return providers[i];
  }
  return null;
}

function extractToolVersions(content) {
  if (!content) return;
  var patterns = [
    /node\s+v?([\d.]+)/i, /npm\s+v?([\d.]+)/i, /python\s+([\d.]+)/i,
    /rustc\s+([\d.]+)/i, /cargo\s+([\d.]+)/i, /deno\s+([\d.]+)/i,
    /go\s+version\s+go([\d.]+)/i, /git\s+version\s+([\d.]+)/i
  ];
  var names = ['node', 'npm', 'python', 'rustc', 'cargo', 'deno', 'go', 'git'];
  for (var i = 0; i < patterns.length; i++) {
    var match = content.match(patterns[i]);
    if (match) snapshot.toolVersions[names[i]] = match[1];
  }
}

function snapshotToString(snap) {
  var lines = ['Environment Snapshot (' + new Date(snap.startTime).toISOString() + ')'];
  lines.push('CWD: ' + (snap.cwd || 'unknown'));
  lines.push('Model: ' + (snap.model || 'unknown'));
  lines.push('Provider: ' + (snap.provider || 'unknown'));
  lines.push('Messages processed: ' + snap.messageCount);
  var tools = Object.keys(snap.toolVersions);
  if (tools.length > 0) {
    lines.push('Tool versions:');
    for (var i = 0; i < tools.length; i++) {
      lines.push('  ' + tools[i] + ': ' + snap.toolVersions[tools[i]]);
    }
  } else {
    lines.push('Tool versions: (none detected)');
  }
  return lines.join('\n');
}

function diffSnapshots(a, b) {
  if (!a || !b) return 'Cannot compare: missing snapshot data.';
  var lines = ['Snapshot Diff:'];
  if (a.cwd !== b.cwd) lines.push('  CWD: ' + (a.cwd || '?') + ' -> ' + (b.cwd || '?'));
  if (a.model !== b.model) lines.push('  Model: ' + (a.model || '?') + ' -> ' + (b.model || '?'));
  if (a.provider !== b.provider) lines.push('  Provider: ' + (a.provider || '?') + ' -> ' + (b.provider || '?'));
  var allTools = {};
  var aTools = a.toolVersions || {};
  var bTools = b.toolVersions || {};
  Object.keys(aTools).forEach(function(k) { allTools[k] = true; });
  Object.keys(bTools).forEach(function(k) { allTools[k] = true; });
  var toolKeys = Object.keys(allTools);
  for (var i = 0; i < toolKeys.length; i++) {
    var k = toolKeys[i];
    var av = aTools[k] || 'absent';
    var bv = bTools[k] || 'absent';
    if (av !== bv) lines.push('  ' + k + ': ' + av + ' -> ' + bv);
  }
  if (lines.length === 1) lines.push('  No differences detected.');
  return lines.join('\n');
}

agor.messages.onMessage(function(msg) {
  var m = safeMsg(msg);
  messagesSeen++;
  snapshot.messageCount = messagesSeen;

  if (messagesSeen > 5 && captured) return;

  var content = m.content || '';
  var tc = m.toolCall || {};
  var toolContent = safeGet(tc, 'content') || safeGet(tc, 'command') || safeGet(tc, 'output') || '';
  var combined = content + ' ' + toolContent;

  if (!snapshot.cwd) snapshot.cwd = extractCwd(combined);
  if (!snapshot.model) snapshot.model = extractModel(combined);
  if (!snapshot.provider) snapshot.provider = extractProvider(combined);
  extractToolVersions(combined);

  if (messagesSeen === 5) {
    captured = true;
    agor.notifications.send('Environment Snapshotter', 'Initial snapshot captured: ' + (snapshot.cwd || 'unknown CWD'));
  }
});

agor.palette.registerCommand('Environment: Current Snapshot', function() {
  agor.notifications.send('Environment Snapshot', snapshotToString(snapshot));
});

agor.palette.registerCommand('Environment: Save Snapshot', function() {
  var ts = new Date().toISOString().replace(/[:.]/g, '-');
  var title = '[ENV:v1:' + ts + ']';
  var desc = snapshotToString(snapshot);
  lastSavedSnapshot = JSON.parse(JSON.stringify(snapshot));
  agor.tasks.create(title, desc);
  agor.notifications.send('Environment Snapshotter', 'Snapshot saved as task: ' + title);
});

agor.palette.registerCommand('Environment: Compare', function() {
  if (!lastSavedSnapshot) {
    agor.notifications.send('Environment Snapshotter', 'No saved snapshot to compare against. Use "Save Snapshot" first.');
    return;
  }
  var diff = diffSnapshots(lastSavedSnapshot, snapshot);
  agor.notifications.send('Environment Diff', diff);
});
