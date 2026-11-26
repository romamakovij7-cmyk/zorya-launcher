function currentOsName() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'osx';
  return 'linux';
}

function currentArch() {
  return process.arch === 'ia32' ? 'x86' : process.arch === 'x64' ? 'x64' : process.arch;
}

function ruleMatches(rule, features) {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== currentOsName()) return false;
    if (rule.os.arch && rule.os.arch !== currentArch()) return false;
  }
  if (rule.features) {
    for (const key of Object.keys(rule.features)) {
      const want = rule.features[key];
      const have = !!(features && features[key]);
      if (want !== have) return false;
    }
  }
  return true;
}

function rulesAllow(rules, features) {
  if (!rules || rules.length === 0) return true;
  let result = false;
  for (const rule of rules) {
    if (ruleMatches(rule, features)) {
      result = rule.action === 'allow';
    }
  }
  return result;
}

module.exports = { currentOsName, currentArch, rulesAllow };
