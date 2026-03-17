function safeGet(obj) { for (var i = 1; i < arguments.length; i++) try { obj = obj[arguments[i]]; } catch(e) { return undefined; } return obj; }
function safeMsg(msg) { return { type: safeGet(msg, 'type') || 'unknown', content: safeGet(msg, 'content') || '', toolCall: safeGet(msg, 'tool_call') || null, role: safeGet(msg, 'role') || 'unknown' }; }

var operations = new Map();

function extractToolName(toolCall) {
  if (!toolCall) return null;
  var name = safeGet(toolCall, 'name') || safeGet(toolCall, 'tool_name');
  return typeof name === 'string' ? name : null;
}

function extractFilePath(toolCall) {
  var input = safeGet(toolCall, 'input');
  if (!input || typeof input !== 'object') return null;

  return input.file_path || input.path || input.filePath ||
    input.file || input.command || null;
}

function recordOperation(name, filePath) {
  var entry = operations.get(name);
  if (entry) {
    entry.count++;
    if (filePath) entry.lastFile = filePath;
  } else {
    operations.set(name, { count: 1, lastFile: filePath || '(none)' });
  }
}

function formatReport() {
  if (operations.size === 0) return 'No tool operations recorded yet.';

  var lines = ['Tool Operation Report', '---------------------'];
  var totalOps = 0;

  var entries = Array.from(operations.entries());
  entries.sort(function(a, b) { return b[1].count - a[1].count; });

  for (var i = 0; i < entries.length; i++) {
    var name = entries[i][0];
    var data = entries[i][1];
    totalOps += data.count;
    lines.push(name + ': ' + data.count + 'x (last: ' + data.lastFile + ')');
  }

  lines.push('---------------------');
  lines.push('Total operations: ' + totalOps);
  lines.push('Unique tool types: ' + operations.size);

  return lines.join('\n');
}

agor.messages.onMessage(function(msg) {
  var safe = safeMsg(msg);
  if (!safe.toolCall) return;

  var toolName = extractToolName(safe.toolCall);
  if (!toolName) return;

  var filePath = extractFilePath(safe.toolCall);
  recordOperation(toolName, filePath);
});

agor.palette.registerCommand('Permission Auditor: Report', function() {
  agor.notifications.send('Permission Auditor', formatReport());
});

agor.palette.registerCommand('Permission Auditor: Reset', function() {
  operations.clear();
  agor.notifications.send('Permission Auditor', 'All counters have been reset.');
});
