function safeGet(obj) { for (var i = 1; i < arguments.length; i++) try { obj = obj[arguments[i]]; } catch(e) { return undefined; } return obj; }
function safeMsg(msg) { return { type: safeGet(msg, 'type') || 'unknown', content: safeGet(msg, 'content') || '', toolCall: safeGet(msg, 'tool_call') || null, role: safeGet(msg, 'role') || 'unknown' }; }

var PATTERNS = [
  { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'GitHub Token', regex: /(?:ghp_|gho_|ghs_)[A-Za-z0-9]{36}/g },
  { name: 'Stripe Key', regex: /(?:sk_live_|sk_test_)[A-Za-z0-9]{24,}/g },
  { name: 'JWT', regex: /eyJ[A-Za-z0-9+/=]{20,}/g }
];

var seen = new Set();
var detectionCount = 0;
var messageIndex = 0;

function simpleHash(str) {
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

function scanText(text, msgIdx) {
  if (typeof text !== 'string' || text.length === 0) return;

  for (var p = 0; p < PATTERNS.length; p++) {
    var pattern = PATTERNS[p];
    pattern.regex.lastIndex = 0;
    var match;

    while ((match = pattern.regex.exec(text)) !== null) {
      var hash = simpleHash(match[0]);
      if (seen.has(hash)) continue;

      seen.add(hash);
      detectionCount++;

      try {
        agor.events.emit('secret.detected', {
          patternType: pattern.name,
          messageIndex: msgIdx
        });
      } catch (e) { /* event emission failed */ }

      try {
        agor.notifications.send(
          'Secret Scanner Alert',
          'Possible ' + pattern.name + ' pattern detected in message #' + msgIdx
        );
      } catch (e) { /* notification failed */ }
    }
  }
}

function extractContent(msg) {
  var safe = safeMsg(msg);
  var parts = [];

  if (safe.content) parts.push(safe.content);

  var toolInput = safeGet(safe.toolCall, 'input');
  if (typeof toolInput === 'string') parts.push(toolInput);
  if (typeof toolInput === 'object' && toolInput !== null) {
    var keys = Object.keys(toolInput);
    for (var i = 0; i < keys.length; i++) {
      if (typeof toolInput[keys[i]] === 'string') parts.push(toolInput[keys[i]]);
    }
  }

  var result = safeGet(msg, 'tool_result');
  if (typeof result === 'string') parts.push(result);
  var resultContent = safeGet(msg, 'tool_result', 'content');
  if (typeof resultContent === 'string') parts.push(resultContent);

  return parts.join('\n');
}

agor.messages.onMessage(function(msg) {
  try {
    messageIndex++;
    var text = extractContent(msg);
    scanText(text, messageIndex);
  } catch (e) { /* scan failed gracefully */ }
});

agor.palette.registerCommand('Secret Scanner: Status', function() {
  agor.notifications.send(
    'Secret Scanner Status',
    'Detections this session: ' + detectionCount +
    '\nUnique patterns found: ' + seen.size +
    '\nMessages scanned: ' + messageIndex
  );
});
