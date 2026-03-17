function safeGet(obj) { for (var i = 1; i < arguments.length; i++) try { obj = obj[arguments[i]]; } catch(e) { return undefined; } return obj; }
function safeMsg(msg) { return { type: safeGet(msg, 'type') || 'unknown', content: safeGet(msg, 'content') || '', toolCall: safeGet(msg, 'tool_call') || null, role: safeGet(msg, 'role') || 'unknown' }; }

var WORK_MS = 25 * 60 * 1000;
var BREAK_MS = 5 * 60 * 1000;
var COST_PER_1K = 0.003;

var state = {
  running: false,
  phase: 'idle',
  startedAt: 0,
  phaseStartedAt: 0,
  intervalId: null,
  blocksCompleted: 0,
  totalFocusMs: 0,
  blockMessages: 0,
  blockTokens: 0,
  sessionCosts: []
};

function estimateTokens(content) { return Math.ceil((content || '').length / 4); }

function formatMs(ms) {
  var mins = Math.floor(ms / 60000);
  var secs = Math.floor((ms % 60000) / 1000);
  return mins + 'm ' + secs + 's';
}

function currentPhaseRemaining() {
  var duration = state.phase === 'work' ? WORK_MS : BREAK_MS;
  var elapsed = Date.now() - state.phaseStartedAt;
  return Math.max(0, duration - elapsed);
}

function blockCost() { return (state.blockTokens / 1000) * COST_PER_1K; }

function startWork() {
  state.phase = 'work';
  state.phaseStartedAt = Date.now();
  state.blockMessages = 0;
  state.blockTokens = 0;
  agor.notifications.send('Focus Timer', 'Work block started (25 min)');
  agor.events.emit('timer.resume', { block: state.blocksCompleted + 1 });
}

function startBreak() {
  var cost = blockCost();
  state.blocksCompleted++;
  state.totalFocusMs += WORK_MS;
  state.sessionCosts.push(cost);
  state.phase = 'break';
  state.phaseStartedAt = Date.now();
  agor.notifications.send('Focus Timer', 'Break time! Block ' + state.blocksCompleted + ' done. Est. cost: $' + cost.toFixed(4));
  agor.events.emit('timer.break', { block: state.blocksCompleted, cost: cost, messages: state.blockMessages });
}

function tick() {
  var remaining = currentPhaseRemaining();
  if (remaining <= 0) {
    if (state.phase === 'work') startBreak();
    else if (state.phase === 'break') startWork();
  }
}

function start() {
  if (state.running) return agor.notifications.send('Focus Timer', 'Timer already running');
  state.running = true;
  state.startedAt = Date.now();
  startWork();
  state.intervalId = setInterval(tick, 1000);
}

function stop() {
  if (!state.running) return agor.notifications.send('Focus Timer', 'Timer not running');
  clearInterval(state.intervalId);
  state.intervalId = null;
  if (state.phase === 'work') {
    var elapsed = Date.now() - state.phaseStartedAt;
    state.totalFocusMs += elapsed;
    state.sessionCosts.push(blockCost());
    state.blocksCompleted++;
  }
  state.running = false;
  state.phase = 'idle';
  var totalCost = state.sessionCosts.reduce(function(a, b) { return a + b; }, 0);
  agor.notifications.send('Focus Timer',
    'Session complete\n' +
    'Blocks: ' + state.blocksCompleted + '\n' +
    'Total focus: ' + formatMs(state.totalFocusMs) + '\n' +
    'Est. total cost: $' + totalCost.toFixed(4)
  );
}

function status() {
  if (!state.running) return agor.notifications.send('Focus Timer', 'Timer not running');
  var remaining = currentPhaseRemaining();
  var totalCost = state.sessionCosts.reduce(function(a, b) { return a + b; }, 0) + (state.phase === 'work' ? blockCost() : 0);
  agor.notifications.send('Focus Timer',
    'Phase: ' + state.phase + '\n' +
    'Remaining: ' + formatMs(remaining) + '\n' +
    'Blocks done: ' + state.blocksCompleted + '\n' +
    'Current block cost: $' + blockCost().toFixed(4) + '\n' +
    'Session cost: $' + totalCost.toFixed(4)
  );
}

agor.palette.registerCommand('Timer: Start', start);
agor.palette.registerCommand('Timer: Stop', stop);
agor.palette.registerCommand('Timer: Status', status);

agor.messages.onMessage(function(msg) {
  if (!state.running || state.phase !== 'work') return;
  var safe = safeMsg(msg);
  state.blockMessages++;
  state.blockTokens += estimateTokens(safe.content);
});
