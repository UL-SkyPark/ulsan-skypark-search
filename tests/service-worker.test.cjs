const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('Fresh data requests bypass previously cached responses', async () => {
  const handlers = {};
  let fetched = 0, cacheReads = 0;
  const context = {
    URL,
    self:{location:{origin:'https://example.test'},addEventListener:(name,handler) => handlers[name] = handler},
    caches:{match:async () => { cacheReads++; return 'old-data'; }},
    fetch:async () => { fetched++; return 'fresh-data'; }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../service-worker.js'),'utf8'),context);
  let result;
  handlers.fetch({request:{method:'GET',url:'https://example.test/data/deceased_data.json',cache:'no-store'}, respondWith:promise => { result = promise; }});
  assert.equal(await result, 'fresh-data');
  assert.equal(fetched, 1);
  assert.equal(cacheReads, 0);
});
