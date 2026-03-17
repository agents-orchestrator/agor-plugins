function safeGet(obj) { for (var i = 1; i < arguments.length; i++) try { obj = obj[arguments[i]]; } catch(e) { return undefined; } return obj; }
function safeMsg(msg) { return { type: safeGet(msg, 'type') || 'unknown', content: safeGet(msg, 'content') || '', toolCall: safeGet(msg, 'tool_call') || null, role: safeGet(msg, 'role') || 'unknown' }; }

var baseline = null;
var current = null;

var patterns = [
  { re: /(\d+)\s+passed/i, field: 'passed' },
  { re: /(\d+)\s+failed/i, field: 'failed' },
  { re: /(\d+)\s+skipped/i, field: 'skipped' },
  { re: /Tests:\s+(\d+)\s+passed/i, field: 'passed' },
  { re: /Tests:\s+(\d+)\s+failed/i, field: 'failed' },
  { re: /test result: ok\.\s+(\d+)\s+passed;\s+(\d+)\s+failed/i, field: 'cargo' },
  { re: /(\d+)\s+passing/i, field: 'passed' },
  { re: /(\d+)\s+failing/i, field: 'failed' }
];

function parseTestOutput(text) {
  var result = { passed: 0, failed: 0, skipped: 0 };
  var hasMatch = false;

  for (var i = 0; i < patterns.length; i++) {
    var match = text.match(patterns[i].re);
    if (!match) continue;
    hasMatch = true;
    if (patterns[i].field === 'cargo') {
      result.passed = parseInt(match[1], 10) || 0;
      result.failed = parseInt(match[2], 10) || 0;
    } else {
      result[patterns[i].field] = parseInt(match[1], 10) || 0;
    }
  }

  return hasMatch ? result : null;
}

function looksLikeTestOutput(text) {
  if (!text) return false;
  var indicators = ['passed', 'failed', 'PASS', 'FAIL', 'test result:', 'Tests:', 'passing', 'failing', 'skipped'];
  return indicators.some(function(ind) { return text.indexOf(ind) !== -1; });
}

function compareAndAlert(prev, next) {
  if (!prev) return;
  var delta = next.passed - prev.passed;

  if (delta < 0) {
    agor.notifications.send('Test Watcher', 'Tests decreased: was ' + prev.passed + ' passed, now ' + next.passed + ' passed (' + delta + ')');
    agor.events.emit('tests.regression', { previous: prev, current: next, delta: delta });
  } else if (delta > 0) {
    agor.notifications.send('Test Watcher', 'Tests improved: +' + delta + ' new passing (total: ' + next.passed + ')');
    agor.events.emit('tests.improvement', { previous: prev, current: next, delta: delta });
  }

  if (next.failed > 0 && (!prev || next.failed > prev.failed)) {
    agor.notifications.send('Test Watcher', 'Failures detected: ' + next.failed + ' failing');
  }
}

function showStatus() {
  if (!current) return agor.notifications.send('Test Watcher', 'No test results captured yet');
  var lines = ['Current: ' + current.passed + ' passed, ' + current.failed + ' failed, ' + current.skipped + ' skipped'];
  if (baseline) {
    var delta = current.passed - baseline.passed;
    lines.push('Baseline: ' + baseline.passed + ' passed, ' + baseline.failed + ' failed');
    lines.push('Delta: ' + (delta >= 0 ? '+' : '') + delta + ' passed');
  }
  agor.notifications.send('Test Watcher', lines.join('\n'));
}

agor.palette.registerCommand('Tests: Current Status', showStatus);

agor.messages.onMessage(function(msg) {
  var safe = safeMsg(msg);
  if (safe.type !== 'tool_result') return;
  if (!looksLikeTestOutput(safe.content)) return;

  var parsed = parseTestOutput(safe.content);
  if (!parsed) return;

  var prev = current;
  current = parsed;
  if (!baseline) baseline = { passed: parsed.passed, failed: parsed.failed, skipped: parsed.skipped };

  compareAndAlert(prev, current);
});
