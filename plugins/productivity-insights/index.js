function safeGet(obj) { for (var i = 1; i < arguments.length; i++) try { obj = obj[arguments[i]]; } catch(e) { return undefined; } return obj; }
function safeMsg(msg) { return { type: safeGet(msg, 'type') || 'unknown', content: safeGet(msg, 'content') || '', toolCall: safeGet(msg, 'tool_call') || null, role: safeGet(msg, 'role') || 'unknown' }; }

var stats = {
  total: 0,
  user: 0,
  assistant: 0,
  toolCalls: 0,
  toolResults: 0,
  errors: 0,
  turns: 0,
  startTime: null,
  lastRole: null
};

function resetStats() {
  stats.total = 0;
  stats.user = 0;
  stats.assistant = 0;
  stats.toolCalls = 0;
  stats.toolResults = 0;
  stats.errors = 0;
  stats.turns = 0;
  stats.startTime = null;
  stats.lastRole = null;
}

function getElapsedMinutes() {
  if (!stats.startTime) return 0;
  return (Date.now() - stats.startTime) / 60000;
}

function formatDashboard() {
  var elapsed = getElapsedMinutes();
  var msgsPerMin = elapsed > 0 ? (stats.total / elapsed).toFixed(1) : '0.0';
  var toolsPerTurn = stats.turns > 0 ? (stats.toolCalls / stats.turns).toFixed(1) : '0.0';
  var errorRate = stats.total > 0 ? ((stats.errors / stats.total) * 100).toFixed(1) : '0.0';

  var lines = [
    'Productivity Dashboard',
    '----------------------',
    'Duration: ' + elapsed.toFixed(1) + ' min',
    '',
    'Messages: ' + stats.total + ' total',
    '  User: ' + stats.user,
    '  Assistant: ' + stats.assistant,
    '  Tool calls: ' + stats.toolCalls,
    '  Tool results: ' + stats.toolResults,
    '  Errors: ' + stats.errors,
    '',
    'Turns (user->assistant): ' + stats.turns,
    'Messages/min: ' + msgsPerMin,
    'Tool calls/turn: ' + toolsPerTurn,
    'Error rate: ' + errorRate + '%'
  ];

  return lines.join('\n');
}

agor.messages.onMessage(function(msg) {
  var safe = safeMsg(msg);

  if (!stats.startTime) stats.startTime = Date.now();
  stats.total++;

  var role = safe.role;
  var type = safe.type;

  if (role === 'user' || type === 'user') {
    stats.user++;
    if (stats.lastRole === 'assistant') {
      stats.turns++;
      if (stats.turns > 0 && stats.turns % 10 === 0) {
        try {
          agor.events.emit('productivity.milestone', {
            turns: stats.turns,
            totalMessages: stats.total,
            elapsed: getElapsedMinutes()
          });
        } catch (e) { /* emit failed */ }
      }
    }
    stats.lastRole = 'user';
  } else if (role === 'assistant' || type === 'assistant') {
    stats.assistant++;
    stats.lastRole = 'assistant';
  }

  if (safe.toolCall) stats.toolCalls++;
  if (type === 'tool_result' || type === 'tool-result') stats.toolResults++;
  if (type === 'error' || safeGet(msg, 'error')) stats.errors++;
});

agor.palette.registerCommand('Productivity: Dashboard', function() {
  agor.notifications.send('Productivity Insights', formatDashboard());
});

agor.palette.registerCommand('Productivity: Reset', function() {
  resetStats();
  agor.notifications.send('Productivity Insights', 'All counters have been reset.');
});
