function safeGet(obj) { for (var i = 1; i < arguments.length; i++) try { obj = obj[arguments[i]]; } catch(e) { return undefined; } return obj; }
function safeMsg(msg) { return { type: safeGet(msg, 'type') || 'unknown', content: safeGet(msg, 'content') || '', toolCall: safeGet(msg, 'tool_call') || null, role: safeGet(msg, 'role') || 'unknown' }; }

var filesModified = [];
var errorCount = 0;
var toolCallCount = 0;
var keyDecisions = [];
var WRITE_OPS = ['Write', 'Edit', 'write_file', 'edit_file', 'create_file'];
var DECISION_KEYWORDS = ['decision', 'chose', 'instead', 'opted', 'trade-off', 'alternative'];

function getFilePath(tc) {
  return safeGet(tc, 'file_path') || safeGet(tc, 'path') || safeGet(tc, 'filename') || '';
}

function getToolName(tc) {
  return safeGet(tc, 'name') || safeGet(tc, 'tool') || safeGet(tc, 'type') || '';
}

function trackFile(filePath) {
  if (!filePath) return;
  if (filesModified.indexOf(filePath) === -1) filesModified.push(filePath);
}

function checkDecision(content) {
  if (!content || content.length < 20) return false;
  var lower = content.toLowerCase();
  for (var i = 0; i < DECISION_KEYWORDS.length; i++) {
    if (lower.indexOf(DECISION_KEYWORDS[i]) !== -1) return true;
  }
  return false;
}

function extractDecisionSummary(content) {
  var sentences = content.split(/[.!?\n]/);
  for (var i = 0; i < sentences.length; i++) {
    var s = sentences[i].trim();
    if (s.length < 10) continue;
    var lower = s.toLowerCase();
    for (var k = 0; k < DECISION_KEYWORDS.length; k++) {
      if (lower.indexOf(DECISION_KEYWORDS[k]) !== -1) {
        return s.length > 120 ? s.substring(0, 117) + '...' : s;
      }
    }
  }
  return content.substring(0, 120);
}

function buildDescription() {
  var lines = [];
  lines.push('Files modified (' + filesModified.length + '):');
  for (var i = 0; i < filesModified.length; i++) lines.push('  - ' + filesModified[i]);
  lines.push('');
  lines.push('Key decisions (' + keyDecisions.length + '):');
  if (keyDecisions.length === 0) {
    lines.push('  (none captured)');
  } else {
    for (var j = 0; j < keyDecisions.length; j++) lines.push('  - ' + keyDecisions[j]);
  }
  lines.push('');
  lines.push('Errors encountered: ' + errorCount);
  lines.push('Tool calls: ' + toolCallCount);
  return lines.join('\n');
}

agor.messages.onMessage(function(msg) {
  var m = safeMsg(msg);

  if (m.type === 'tool_call' || m.type === 'tool_use') {
    toolCallCount++;
    var tc = m.toolCall || msg;
    var toolName = getToolName(tc);
    if (WRITE_OPS.indexOf(toolName) !== -1) trackFile(getFilePath(tc));
  }

  if (m.type === 'error' || m.type === 'tool_error') errorCount++;

  if (m.role === 'assistant' && m.content && checkDecision(m.content)) {
    var summary = extractDecisionSummary(m.content);
    if (keyDecisions.length < 20) keyDecisions.push(summary);
  }
});

function createReview() {
  if (filesModified.length === 0 && toolCallCount === 0) {
    agor.notifications.send('Review Handoff', 'No activity to review yet.');
    return;
  }
  var title = 'Review: ' + filesModified.length + ' files, ' + toolCallCount + ' tool calls';
  var desc = buildDescription();
  agor.tasks.create(title, desc);
  agor.notifications.send('Review Handoff', 'Review task created with ' + filesModified.length + ' files.');
}

agor.events.on('session.complete', function() { createReview(); });

agor.palette.registerCommand('Review Handoff: Create Review', function() { createReview(); });
