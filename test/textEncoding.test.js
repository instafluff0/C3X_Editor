const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const iconv = require('iconv-lite');

const {
  detectTextFileEncodingFromBuffer,
  readTextFileWithEncodingInfoIfExists,
  loadBundle,
  saveBundle,
  buildScenarioCivilopediaEditResult,
  buildScenarioDiplomacyEditResult
} = require('../src/configCore');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-encoding-'));
}

function writeEncoded(filePath, text, encoding) {
  fs.writeFileSync(filePath, iconv.encode(text, encoding));
}

function norm(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

const LEGACY_CASES = [
  {
    label: 'Windows-1251 Cyrillic',
    encoding: 'windows-1251',
    sample: '#RACE_TEST\nРусский текст энциклопедии\n',
    updated: 'Обновленный текст цивилопедии'
  },
  {
    label: 'GBK Simplified Chinese',
    encoding: 'gbk',
    sample: '#RACE_TEST\n简体中文百科内容\n',
    updated: '更新后的简体中文内容'
  },
  {
    label: 'Big5 Traditional Chinese',
    encoding: 'big5',
    sample: '#RACE_TEST\n繁體中文百科內容\n',
    updated: '更新後的繁體中文內容'
  },
  {
    label: 'Shift-JIS Japanese',
    encoding: 'shift_jis',
    sample: '#RACE_TEST\n日本語の百科事典テキスト\n',
    updated: '更新後の日本語テキスト'
  },
  {
    label: 'EUC-KR Korean',
    encoding: 'euc-kr',
    sample: '#RACE_TEST\n한국어 백과사전 텍스트\n',
    updated: '업데이트된 한국어 텍스트'
  }
];

for (const entry of LEGACY_CASES) {
  test(`detectTextFileEncodingFromBuffer identifies ${entry.label}`, () => {
    const buffer = iconv.encode(entry.sample, entry.encoding);
    assert.equal(detectTextFileEncodingFromBuffer(buffer, 'auto'), entry.encoding);
  });

  test(`readTextFileWithEncodingInfoIfExists decodes ${entry.label}`, () => {
    const root = mkTmpDir();
    const filePath = path.join(root, 'Civilopedia.txt');
    writeEncoded(filePath, entry.sample, entry.encoding);

    const info = readTextFileWithEncodingInfoIfExists(filePath, { preferredEncoding: 'auto' });
    assert.ok(info);
    assert.equal(info.encoding, entry.encoding);
    assert.equal(norm(info.text), norm(entry.sample));
    assert.equal(info.bom, false);
  });

  test(`buildScenarioCivilopediaEditResult preserves ${entry.label} on save`, () => {
    const root = mkTmpDir();
    const filePath = path.join(root, 'Civilopedia.txt');
    const initial = ['#RACE_TEST', entry.sample.split('\n')[1], '', ''].join('\n');
    writeEncoded(filePath, initial, entry.encoding);

    const result = buildScenarioCivilopediaEditResult({
      targetPath: filePath,
      edits: [{ sectionKey: 'RACE_TEST', value: entry.updated }],
      preferredEncoding: 'auto'
    });

    assert.equal(result.ok, true);
    assert.equal(result.encoding, entry.encoding);
    fs.writeFileSync(filePath, result.buffer);

    const info = readTextFileWithEncodingInfoIfExists(filePath, { preferredEncoding: 'auto' });
    assert.ok(info);
    assert.equal(info.encoding, entry.encoding);
    assert.match(info.text, new RegExp(entry.updated.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
}

test('buildScenarioDiplomacyEditResult preserves UTF-8 BOM when rewriting text', () => {
  const root = mkTmpDir();
  const filePath = path.join(root, 'diplomacy.txt');
  const initial = '#AIFIRSTCONTACT\n^Hello there\n#AIFIRSTDEAL\n^Deal text\n';
  fs.writeFileSync(filePath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(initial, 'utf8')]));

  const result = buildScenarioDiplomacyEditResult({
    targetPath: filePath,
    sourcePath: filePath,
    edits: [{ index: 0, firstContact: '你好', firstDeal: '成交' }],
    preferredEncoding: 'auto'
  });

  assert.equal(result.ok, true);
  assert.equal(result.encoding, 'utf8');
  assert.equal(result.bom, true);
  assert.equal(result.buffer[0], 0xef);
  assert.equal(result.buffer[1], 0xbb);
  assert.equal(result.buffer[2], 0xbf);
});

test('loadBundle decodes localized district configs with text-file encoding auto-detection', () => {
  const c3xPath = mkTmpDir();
  fs.writeFileSync(path.join(c3xPath, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');
  writeEncoded(
    path.join(c3xPath, 'default.districts_config.txt'),
    '#District\nname = 灌溉区\ndisplay_name = 农业枢纽\ntooltip = 提供粮食\n',
    'gbk'
  );
  fs.writeFileSync(path.join(c3xPath, 'default.districts_wonders_config.txt'), '#Wonder\nname = Wonder\n', 'utf8');
  fs.writeFileSync(path.join(c3xPath, 'default.districts_natural_wonders_config.txt'), '#Wonder\nname = Natural\n', 'utf8');
  fs.writeFileSync(path.join(c3xPath, 'default.tile_animations.txt'), '#Animation\nname = Anim\n', 'utf8');

  const bundle = loadBundle({ mode: 'global', c3xPath, civ3Path: '', scenarioPath: '', textFileEncoding: 'auto' });
  const fields = bundle.tabs.districts.model.sections[0].fields;
  assert.equal(fields.find((field) => field.key === 'name').value, '灌溉区');
  assert.equal(fields.find((field) => field.key === 'display_name').value, '农业枢纽');
  assert.equal(bundle.tabs.districts.sourceDetails.activeEncoding, 'gbk');
});

test('saveBundle preserves localized district config encoding', () => {
  const c3xPath = mkTmpDir();
  const userPath = path.join(c3xPath, 'user.districts_config.txt');
  fs.writeFileSync(path.join(c3xPath, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');
  writeEncoded(
    path.join(c3xPath, 'default.districts_config.txt'),
    '#District\nname = 灌溉区\ndisplay_name = 农业枢纽\ntooltip = 提供粮食\n',
    'gbk'
  );
  fs.writeFileSync(path.join(c3xPath, 'default.districts_wonders_config.txt'), '#Wonder\nname = Wonder\n', 'utf8');
  fs.writeFileSync(path.join(c3xPath, 'default.districts_natural_wonders_config.txt'), '#Wonder\nname = Natural\n', 'utf8');
  fs.writeFileSync(path.join(c3xPath, 'default.tile_animations.txt'), '#Animation\nname = Anim\n', 'utf8');

  const bundle = loadBundle({ mode: 'global', c3xPath, civ3Path: '', scenarioPath: '', textFileEncoding: 'auto' });
  const display = bundle.tabs.districts.model.sections[0].fields.find((field) => field.key === 'display_name');
  display.value = '农业中心';

  const result = saveBundle({
    mode: 'global',
    c3xPath,
    civ3Path: '',
    scenarioPath: '',
    textFileEncoding: 'auto',
    dirtyTabs: ['districts'],
    tabs: bundle.tabs
  });

  assert.equal(result.ok, true);
  const info = readTextFileWithEncodingInfoIfExists(userPath, { preferredEncoding: 'auto' });
  assert.ok(info);
  assert.equal(info.encoding, 'gbk');
  assert.match(info.text, /display_name\s*=\s*"农业中心"/);
});
