/**
 * 울산하늘공원 접수 현황 - 공유 상태 저장 API
 *
 * 연결 스프레드시트:
 * https://docs.google.com/spreadsheets/d/15MLNKcKp0KogwFAjWxY1KHrjh3yOn4uI3psa5MQR_UE/edit
 *
 * 프론트엔드는 GitHub Pages 같은 외부 도메인에서 실행하므로
 * Apps Script CORS 문제를 피하기 위해 JSONP GET 방식을 지원합니다.
 *
 * 요청 예시
 * - JSON:  /exec?action=list
 * - JSONP: /exec?action=list&callback=함수명
 * - 저장:  /exec?action=save&src=house&mode=ret&id=62실2022169&status=반환완료&callback=함수명
 */
const CONFIG = {
  SPREADSHEET_ID: '15MLNKcKp0KogwFAjWxY1KHrjh3yOn4uI3psa5MQR_UE',
  STATUS_SHEET_NAME: 'status',
  HEADERS: ['src', 'mode', 'id', 'status', 'updatedAt', 'updatedBy'],
};

function setup() {
  const sheet = getStatusSheet_();
  ensureHeader_(sheet);
  return output_({ ok: true, message: 'setup complete', sheetName: CONFIG.STATUS_SHEET_NAME });
}

function doGet(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};
    const action = String(params.action || 'list').trim().toLowerCase();

    if (action === 'list') {
      return output_({ ok: true, items: listStatuses_(), serverTime: new Date().toISOString() }, e);
    }

    if (action === 'save') {
      const payload = {
        src: params.src,
        mode: params.mode,
        id: params.id,
        status: params.status,
      };
      return output_({ ok: true, item: saveStatus_(payload), serverTime: new Date().toISOString() }, e);
    }

    if (action === 'health') {
      return output_({ ok: true, message: 'status api ready', serverTime: new Date().toISOString() }, e);
    }

    return output_({ ok: false, message: 'unknown action' }, e);
  } catch (err) {
    return output_({ ok: false, message: String((err && err.message) || err) }, e);
  }
}

function doPost(e) {
  try {
    const payload = parsePostPayload_(e);
    const action = String(payload.action || 'save').trim().toLowerCase();

    if (action === 'list') {
      return output_({ ok: true, items: listStatuses_(), serverTime: new Date().toISOString() }, e);
    }

    if (action === 'save') {
      return output_({ ok: true, item: saveStatus_(payload), serverTime: new Date().toISOString() }, e);
    }

    return output_({ ok: false, message: 'unknown action' }, e);
  } catch (err) {
    return output_({ ok: false, message: String((err && err.message) || err) }, e);
  }
}

function parsePostPayload_(e) {
  const contents = e && e.postData && e.postData.contents ? String(e.postData.contents) : '';

  if (contents) {
    try {
      return JSON.parse(contents);
    } catch (err) {
      // JSON이 아닌 form 형식으로 들어온 경우를 대비합니다.
    }
  }

  const params = e && e.parameter ? e.parameter : {};
  return {
    action: params.action,
    src: params.src,
    mode: params.mode,
    id: params.id,
    status: params.status,
  };
}

function getStatusSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.STATUS_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.STATUS_SHEET_NAME);
  }

  return sheet;
}

function ensureHeader_(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), CONFIG.HEADERS.length);
  let header = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(value => String(value || '').trim());

  const isEmptyHeader = header.every(value => !value);
  if (isEmptyHeader) {
    header = CONFIG.HEADERS.slice();
  } else {
    CONFIG.HEADERS.forEach(name => {
      if (!header.includes(name)) header.push(name);
    });
  }

  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  sheet.setFrozenRows(1);

  const index = {};
  header.forEach((name, i) => {
    if (name) index[name] = i;
  });

  CONFIG.HEADERS.forEach(name => {
    if (index[name] == null) throw new Error('required header missing: ' + name);
  });

  return { header, index };
}

function listStatuses_() {
  const sheet = getStatusSheet_();
  const meta = ensureHeader_(sheet);
  const lastRow = sheet.getLastRow();
  const lastColumn = Math.max(sheet.getLastColumn(), meta.header.length);

  if (lastRow <= 1) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  const latestByKey = new Map();

  values.forEach(row => {
    const item = rowToItem_(row, meta.index);
    if (!item.src || !item.mode || !item.id || !item.status) return;
    latestByKey.set(statusKey_(item.src, item.mode, item.id), item);
  });

  return Array.from(latestByKey.values());
}

function saveStatus_(payload) {
  const src = clean_(payload.src);
  const mode = clean_(payload.mode);
  const id = clean_(payload.id);
  const status = clean_(payload.status);

  if (!src) throw new Error('src is required');
  if (!mode) throw new Error('mode is required');
  if (!id) throw new Error('id is required');
  if (!status) throw new Error('status is required');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getStatusSheet_();
    const meta = ensureHeader_(sheet);
    const lastRow = sheet.getLastRow();
    const lastColumn = Math.max(sheet.getLastColumn(), meta.header.length);
    const now = new Date();
    const user = getUserEmail_();
    const targetKey = statusKey_(src, mode, id);

    let targetRow = 0;

    if (lastRow > 1) {
      const values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
      for (let i = 0; i < values.length; i++) {
        const item = rowToItem_(values[i], meta.index);
        if (statusKey_(item.src, item.mode, item.id) === targetKey) {
          targetRow = i + 2;
          break;
        }
      }
    }

    const output = {
      src: src,
      mode: mode,
      id: id,
      status: status,
      updatedAt: now.toISOString(),
      updatedBy: user,
    };

    if (targetRow) {
      sheet.getRange(targetRow, meta.index.status + 1).setValue(status);
      sheet.getRange(targetRow, meta.index.updatedAt + 1).setValue(now);
      sheet.getRange(targetRow, meta.index.updatedBy + 1).setValue(user);
    } else {
      const row = new Array(meta.header.length).fill('');
      row[meta.index.src] = src;
      row[meta.index.mode] = mode;
      row[meta.index.id] = id;
      row[meta.index.status] = status;
      row[meta.index.updatedAt] = now;
      row[meta.index.updatedBy] = user;
      sheet.appendRow(row);
    }

    return output;
  } finally {
    lock.releaseLock();
  }
}

function rowToItem_(row, index) {
  const updatedAt = row[index.updatedAt];

  return {
    src: clean_(row[index.src]),
    mode: clean_(row[index.mode]),
    id: clean_(row[index.id]),
    status: clean_(row[index.status]),
    updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : clean_(updatedAt),
    updatedBy: clean_(row[index.updatedBy]),
  };
}

function statusKey_(src, mode, id) {
  return [clean_(src), clean_(mode), clean_(id)].join('||');
}

function clean_(value) {
  return String(value == null ? '' : value).trim();
}

function getUserEmail_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (err) {
    return '';
  }
}

function output_(obj, e) {
  const params = e && e.parameter ? e.parameter : {};
  const callback = String(params.callback || '').trim();

  if (isValidCallbackName_(callback)) {
    return ContentService
      .createTextOutput(callback + '(' + JSON.stringify(obj) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function isValidCallbackName_(name) {
  return /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(name);
}
