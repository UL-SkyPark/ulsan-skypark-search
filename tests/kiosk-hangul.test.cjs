const assert = require('node:assert/strict');
const { test } = require('node:test');
const Composer = require('../kiosk.js');

function type(keys) {
  const c = new Composer();
  let committed = '';
  for (const key of keys) committed += c.push(key).commit;
  return committed + c.pending;
}

test('Korean names and double consonants', () => {
  assert.equal(type('ㅎㅗㅇㄱㅣㄹㄷㅗㅇ'), '홍길동');
  assert.equal(type('ㄱㅣㅁㅊㅓㄹㅅㅜ'), '김철수');
  assert.equal(type('ㅇㅣㅆㅏㅇ'), '이쌍');
  assert.equal(type('ㄲㅗㅊ'), '꽃');
});
test('Compound vowels, final clusters, and transfer to the next syllable', () => {
  assert.equal(type('ㄱㅗㅏㄱ'), '곽');
  assert.equal(type('ㄱㅜㅓㄴ'), '권');
  assert.equal(type('ㅇㅡㅣ'), '의');
  assert.equal(type('ㄷㅏㄹㄱ'), '닭');
  assert.equal(type('ㄷㅏㄹㄱㅏ'), '달가');
  assert.equal(type('ㄱㅏㅂㅅㅣ'), '갑시');
  assert.equal(type('ㄱㅏㄴㅏ'), '가나');
});
test('Backspace reverses composition one keystroke at a time', () => {
  const c = new Composer();
  for (const key of 'ㄱㅗㅏㄴ') c.push(key);
  assert.equal(c.pending, '관');
  assert.equal(c.backspace(), '과');
  assert.equal(c.backspace(), '고');
  assert.equal(c.backspace(), 'ㄱ');
  assert.equal(c.backspace(), '');
  for (const key of 'ㄱㅏㄴㅏ') c.push(key);
  assert.equal(c.pending, '나');
  assert.equal(c.backspace(), 'ㄴ');
  assert.equal(c.backspace(), '');
});
test('Standalone jamo and committed composition do not leak into the next name', () => {
  assert.equal(type('ㅗㅏ'), 'ㅘ');
  assert.equal(type('ㄱㄴ'), 'ㄱㄴ');
  const c = new Composer(); c.push('ㄱ'); c.reset();
  assert.equal(c.push('ㅏ').pending, 'ㅏ');
});
