function safeGet(obj) { for (var i = 1; i < arguments.length; i++) try { obj = obj[arguments[i]]; } catch(e) { return undefined; } return obj; }
function safeMsg(msg) { return { type: safeGet(msg, 'type') || 'unknown', content: safeGet(msg, 'content') || '', toolCall: safeGet(msg, 'tool_call') || null, role: safeGet(msg, 'role') || 'unknown' }; }

var SUGGESTIONS = {
  message_count: 'Your conversation is getting long ({count} messages). Consider summarizing: paste this prompt: "Summarize our progress so far and the current state of the code"',
  token_estimate: 'Estimated token usage is high (~{tokens}k). Consider starting a focused sub-task: paste this prompt: "Let\'s focus on just [specific task]. Here\'s the relevant context: [paste key details]"',
  consecutive_errors: 'Multiple consecutive tool errors detected ({count}). Consider re-orienting: paste this prompt: "Let\'s step back. What are we trying to accomplish, and what approach should we take instead?"',
  repeated_prompts: 'Similar prompts detected — possible loop. Consider clarifying: paste this prompt: "I notice we\'re going in circles. Here\'s exactly what I need: [be very specific about the desired outcome]"',
  general_drift: 'Session may be drifting. Consider a checkpoint: paste this prompt: "Before we continue, list: 1) what we\'ve done, 2) what\'s left, 3) any blockers"'
};

var messageCount = 0;
var estimatedTokens = 0;
var consecutiveErrors = 0;
var recentPrompts = [];
var lastAlertAt = 0;
var MAX_RECENT_PROMPTS = 10;
var COOLDOWN = 20;

function shouldAlert() {
  return (messageCount - lastAlertAt) >= COOLDOWN;
}

function emitDrift(reason) {
  lastAlertAt = messageCount;
  try {
    agor.events.emit('context.drift', {
      reason: reason,
      messageCount: messageCount,
      estimatedTokens: estimatedTokens
    });
  } catch (e) { /* emit failed */ }
}

function notify(template, vars) {
  var text = template;
  if (vars) {
    var keys = Object.keys(vars);
    for (var i = 0; i < keys.length; i++) {
      text = text.replace('{' + keys[i] + '}', String(vars[keys[i]]));
    }
  }
  try {
    agor.notifications.send('Context Drift Warning', text);
  } catch (e) { /* notification failed */ }
}

function simpleSimilarity(a, b) {
  if (!a || !b) return 0;
  var shorter = a.length < b.length ? a : b;
  var longer = a.length < b.length ? b : a;
  if (longer.length === 0) return 1;
  var matches = 0;
  var words = shorter.toLowerCase().split(/\s+/);
  var longerLower = longer.toLowerCase();
  for (var i = 0; i < words.length; i++) {
    if (words[i].length > 3 && longerLower.indexOf(words[i]) !== -1) matches++;
  }
  return words.length > 0 ? matches / words.length : 0;
}

function checkRepeatedPrompts(content) {
  if (typeof content !== 'string' || content.length < 20) return false;
  for (var i = 0; i < recentPrompts.length; i++) {
    if (simpleSimilarity(content, recentPrompts[i]) > 0.7) return true;
  }
  recentPrompts.push(content);
  if (recentPrompts.length > MAX_RECENT_PROMPTS) recentPrompts.shift();
  return false;
}

function checkDrift() {
  if (!shouldAlert()) return;

  if (consecutiveErrors >= 5) {
    notify(SUGGESTIONS.consecutive_errors, { count: consecutiveErrors });
    emitDrift('consecutive_errors');
    return;
  }

  if (estimatedTokens > 100000) {
    notify(SUGGESTIONS.token_estimate, { tokens: Math.round(estimatedTokens / 1000) });
    emitDrift('token_estimate');
    return;
  }

  if (messageCount > 50) {
    notify(SUGGESTIONS.message_count, { count: messageCount });
    emitDrift('message_count');
    return;
  }
}

agor.messages.onMessage(function(msg) {
  var safe = safeMsg(msg);
  messageCount++;

  var content = safe.content;
  if (typeof content === 'string') {
    estimatedTokens += Math.ceil(content.length / 4);
  }

  var type = safe.type;
  if (type === 'error' || safeGet(msg, 'error')) {
    consecutiveErrors++;
  } else if (type !== 'tool_result' && type !== 'tool-result') {
    consecutiveErrors = 0;
  }

  var role = safe.role;
  if ((role === 'user' || type === 'user') && typeof content === 'string') {
    if (checkRepeatedPrompts(content) && shouldAlert()) {
      notify(SUGGESTIONS.repeated_prompts, {});
      emitDrift('repeated_prompts');
      return;
    }
  }

  checkDrift();
});
