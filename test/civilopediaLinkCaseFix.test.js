const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function extractFunctionSource(sourceText, functionName) {
  const start = sourceText.indexOf(`function ${functionName}`);
  if (start < 0) throw new Error(`Missing function ${functionName}`);
  const signatureEnd = sourceText.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = signatureEnd; i < sourceText.length; i += 1) {
    const ch = sourceText[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return sourceText.slice(start, end);
}

function loadHelpers() {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  const sandbox = {
    CIVILOPEDIA_LINK_PATTERN: /\$LINK<([^=<>]+)=([^<>]+)>/g
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${extractFunctionSource(sourceText, 'replaceFirstCivilopediaLinkTarget')}\n`
      + 'globalThis.__helpers = { replaceFirstCivilopediaLinkTarget };',
    sandbox,
    { filename: 'civilopedia-link-case-fix.vm' }
  );
  return sandbox.__helpers;
}

test('replaceFirstCivilopediaLinkTarget changes only the clicked link target casing', () => {
  const { replaceFirstCivilopediaLinkTarget } = loadHelpers();
  const before = [
    'Intro $LINK<Jaggedswine Farm=BLDG_Jaggedswine_Farm> text.',
    'Display casing stays $LINK<lower label=BLDG_Jaggedswine_Farm>.'
  ].join('\n');

  const after = replaceFirstCivilopediaLinkTarget(before, 'BLDG_Jaggedswine_Farm', 'BLDG_JaggedSwine_Farm');

  assert.equal(after, [
    'Intro $LINK<Jaggedswine Farm=BLDG_JaggedSwine_Farm> text.',
    'Display casing stays $LINK<lower label=BLDG_Jaggedswine_Farm>.'
  ].join('\n'));
});

test('replaceFirstCivilopediaLinkTarget is a no-op when the target is not an exact case mismatch', () => {
  const { replaceFirstCivilopediaLinkTarget } = loadHelpers();
  const before = 'Exact $LINK<JaggedSwine Farm=BLDG_JaggedSwine_Farm>.';

  assert.equal(
    replaceFirstCivilopediaLinkTarget(before, 'BLDG_Jaggedswine_Farm', 'BLDG_JaggedSwine_Farm'),
    before
  );
  assert.equal(
    replaceFirstCivilopediaLinkTarget(before, 'BLDG_JaggedSwine_Farm', 'BLDG_JaggedSwine_Farm'),
    before
  );
});
