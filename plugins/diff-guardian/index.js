function safeGet(obj) { for (var i = 1; i < arguments.length; i++) try { obj = obj[arguments[i]]; } catch(e) { return undefined; } return obj; }
function safeMsg(msg) { return { type: safeGet(msg, 'type') || 'unknown', content: safeGet(msg, 'content') || '', toolCall: safeGet(msg, 'tool_call') || null, role: safeGet(msg, 'role') || 'unknown' }; }

var warningCount = 0;
var recentAlerts = [];
var unrecognizedCount = 0;
var formatNotified = false;

var WRITE_OPS = ['Write', 'Edit', 'write_file', 'edit_file', 'create_file'];
var BASH_OPS = ['Bash', 'bash', 'shell', 'execute'];
var SENSITIVE_FILES = ['.env', '.gitignore', '.npmrc', '.htpasswd', 'id_rsa', 'credentials', 'secrets'];
var DANGEROUS_BASH = ['rm -rf', 'chmod 777', 'eval(', 'eval ', '> /dev/sd', 'mkfs', 'dd if='];

function getFilePath(tc) {
  return safeGet(tc, 'file_path') || safeGet(tc, 'path') || safeGet(tc, 'filename') || '';
}

function getToolName(tc) {
  return safeGet(tc, 'name') || safeGet(tc, 'tool') || safeGet(tc, 'type') || '';
}

function getContent(tc) {
  return safeGet(tc, 'content') || safeGet(tc, 'new_string') || safeGet(tc, 'command') || '';
}

function isSensitiveFile(filePath) {
  var lower = filePath.toLowerCase();
  for (var i = 0; i < SENSITIVE_FILES.length; i++) {
    if (lower.indexOf(SENSITIVE_FILES[i]) !== -1) return SENSITIVE_FILES[i];
  }
  return null;
}

function checkBashDangers(command) {
  var found = [];
  for (var i = 0; i < DANGEROUS_BASH.length; i++) {
    if (command.indexOf(DANGEROUS_BASH[i]) !== -1) found.push(DANGEROUS_BASH[i]);
  }
  return found;
}

function hasBinaryContent(content) {
  if (!content || content.length < 20) return false;
  var nonPrintable = 0;
  var sample = content.substring(0, 500);
  for (var i = 0; i < sample.length; i++) {
    var code = sample.charCodeAt(i);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) nonPrintable++;
  }
  return (nonPrintable / sample.length) > 0.1;
}

function addWarning(severity, pattern, filePath) {
  warningCount++;
  var alert = { severity: severity, pattern: pattern, filePath: filePath, time: Date.now() };
  recentAlerts.push(alert);
  if (recentAlerts.length > 20) recentAlerts.shift();
  agor.notifications.send('Diff Guardian [' + severity.toUpperCase() + ']', pattern + (filePath ? ': ' + filePath : ''));
  agor.events.emit('diff.warning', alert);
}

agor.messages.onMessage(function(msg) {
  var m = safeMsg(msg);
  if (m.type !== 'tool_call' && m.type !== 'tool_use') return;

  var tc = m.toolCall || msg;
  var toolName = getToolName(tc);
  var filePath = getFilePath(tc);
  var content = getContent(tc);
  var isWrite = WRITE_OPS.indexOf(toolName) !== -1;
  var isBash = BASH_OPS.indexOf(toolName) !== -1;

  if (!isWrite && !isBash) {
    unrecognizedCount++;
    if (unrecognizedCount === 10 && !formatNotified) {
      formatNotified = true;
      agor.notifications.send('Diff Guardian', '10 unrecognized tool_call formats encountered');
      agor.events.emit('format.unrecognized', { count: unrecognizedCount });
    }
    return;
  }

  if (isWrite) {
    var sensitive = isSensitiveFile(filePath);
    if (sensitive) addWarning('danger', 'Sensitive file overwrite (' + sensitive + ')', filePath);
    if (content && content.split('\n').length > 500) addWarning('warning', 'Large file write (>500 lines)', filePath);
    if (hasBinaryContent(content)) addWarning('warning', 'Binary content detected', filePath);
    if (content && content.indexOf('eval(') !== -1) addWarning('danger', 'eval() injection detected', filePath);
  }

  if (isBash && content) {
    var dangers = checkBashDangers(content);
    for (var i = 0; i < dangers.length; i++) {
      addWarning('danger', 'Dangerous bash pattern: ' + dangers[i], '');
    }
  }
});

agor.palette.registerCommand('Diff Guardian: Status', function() {
  var lines = ['Diff Guardian - ' + agor.meta.name + ' v' + agor.meta.version];
  lines.push('Warnings this session: ' + warningCount);
  lines.push('Unrecognized tool_calls: ' + unrecognizedCount);
  lines.push('');
  if (recentAlerts.length === 0) {
    lines.push('No alerts recorded.');
  } else {
    lines.push('Recent alerts (last ' + Math.min(recentAlerts.length, 10) + '):');
    var start = Math.max(0, recentAlerts.length - 10);
    for (var i = start; i < recentAlerts.length; i++) {
      var a = recentAlerts[i];
      lines.push('  [' + a.severity + '] ' + a.pattern + (a.filePath ? ' - ' + a.filePath : ''));
    }
  }
  agor.notifications.send('Diff Guardian Status', lines.join('\n'));
});
