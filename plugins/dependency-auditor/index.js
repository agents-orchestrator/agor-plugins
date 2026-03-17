function safeGet(obj) { for (var i = 1; i < arguments.length; i++) try { obj = obj[arguments[i]]; } catch(e) { return undefined; } return obj; }
function safeMsg(msg) { return { type: safeGet(msg, 'type') || 'unknown', content: safeGet(msg, 'content') || '', toolCall: safeGet(msg, 'tool_call') || null, role: safeGet(msg, 'role') || 'unknown' }; }

var addedDeps = [];
var DEP_FILES = ['package.json', 'Cargo.toml', 'requirements.txt', 'go.mod', 'pyproject.toml', 'Gemfile'];
var WRITE_OPS = ['Write', 'Edit', 'write_file', 'edit_file', 'create_file'];
var RISKY_PATTERNS = ['crypto-', 'hack', 'backdoor', 'trojan', 'keylog', 'steal'];
var LOOSE_VERSIONS = ['^', '~', '*'];

function getFilePath(tc) {
  return safeGet(tc, 'file_path') || safeGet(tc, 'path') || safeGet(tc, 'filename') || '';
}

function getToolName(tc) {
  return safeGet(tc, 'name') || safeGet(tc, 'tool') || safeGet(tc, 'type') || '';
}

function getContent(tc) {
  return safeGet(tc, 'content') || safeGet(tc, 'new_string') || safeGet(tc, 'command') || '';
}

function isDepFile(filePath) {
  for (var i = 0; i < DEP_FILES.length; i++) {
    if (filePath.indexOf(DEP_FILES[i]) !== -1) return DEP_FILES[i];
  }
  return null;
}

function isRiskyName(name) {
  var lower = name.toLowerCase();
  for (var i = 0; i < RISKY_PATTERNS.length; i++) {
    if (lower.indexOf(RISKY_PATTERNS[i]) !== -1) return true;
  }
  return false;
}

function hasLooseVersion(version) {
  for (var i = 0; i < LOOSE_VERSIONS.length; i++) {
    if (version.indexOf(LOOSE_VERSIONS[i]) !== -1) return LOOSE_VERSIONS[i];
  }
  return null;
}

function extractJsonDeps(content) {
  var deps = [];
  var sections = ['"dependencies"', '"devDependencies"', '"peerDependencies"'];
  for (var s = 0; s < sections.length; s++) {
    var idx = content.indexOf(sections[s]);
    if (idx === -1) continue;
    var braceStart = content.indexOf('{', idx);
    if (braceStart === -1) continue;
    var depth = 1, end = braceStart + 1;
    while (end < content.length && depth > 0) {
      if (content[end] === '{') depth++;
      if (content[end] === '}') depth--;
      end++;
    }
    var block = content.substring(braceStart, end);
    var re = /"([^"]+)"\s*:\s*"([^"]+)"/g;
    var match;
    while ((match = re.exec(block)) !== null) deps.push({ name: match[1], version: match[2] });
  }
  return deps;
}

function extractTOMLDeps(content) {
  var deps = [];
  var re = /^\s*([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/gm;
  var match;
  var inDeps = content.indexOf('[dependencies]') !== -1 || content.indexOf('[dev-dependencies]') !== -1;
  if (!inDeps) return deps;
  while ((match = re.exec(content)) !== null) deps.push({ name: match[1], version: match[2] });
  return deps;
}

function extractSimpleDeps(content, file) {
  var deps = [];
  var lines = content.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line || line[0] === '#' || line[0] === '/') continue;
    var parts = line.split(/[=<>~!@\s]+/);
    if (parts[0]) deps.push({ name: parts[0], version: parts[1] || 'latest' });
  }
  return deps;
}

function recordDep(file, name, version) {
  for (var i = 0; i < addedDeps.length; i++) {
    if (addedDeps[i].file === file && addedDeps[i].name === name) return;
  }
  addedDeps.push({ file: file, name: name, version: version, time: Date.now() });
  var warnings = [];
  if (isRiskyName(name)) warnings.push('RISKY NAME');
  var loose = hasLooseVersion(version);
  if (loose) warnings.push('loose version (' + loose + ')');
  var label = warnings.length > 0 ? ' [' + warnings.join(', ') + ']' : '';
  agor.notifications.send('Dependency Auditor', 'New dependency: ' + name + '@' + version + ' in ' + file + label);
  agor.events.emit('dependency.added', { file: file, packageName: name, version: version, warnings: warnings });
}

agor.messages.onMessage(function(msg) {
  var m = safeMsg(msg);
  if (m.type !== 'tool_call' && m.type !== 'tool_use') return;
  var tc = m.toolCall || msg;
  var toolName = getToolName(tc);
  if (WRITE_OPS.indexOf(toolName) === -1) return;
  var filePath = getFilePath(tc);
  var depFile = isDepFile(filePath);
  if (!depFile) return;
  var content = getContent(tc);
  if (!content) return;

  var deps = [];
  if (depFile === 'package.json') deps = extractJsonDeps(content);
  else if (depFile === 'Cargo.toml') deps = extractTOMLDeps(content);
  else deps = extractSimpleDeps(content, depFile);

  for (var i = 0; i < deps.length; i++) recordDep(depFile, deps[i].name, deps[i].version);
});

agor.palette.registerCommand('Dependency Auditor: Summary', function() {
  var lines = ['Dependencies added this session: ' + addedDeps.length];
  if (addedDeps.length === 0) {
    lines.push('No new dependencies detected.');
  } else {
    for (var i = 0; i < addedDeps.length; i++) {
      var d = addedDeps[i];
      lines.push('  ' + d.name + '@' + d.version + ' (' + d.file + ')');
    }
  }
  agor.notifications.send('Dependency Auditor', lines.join('\n'));
});
