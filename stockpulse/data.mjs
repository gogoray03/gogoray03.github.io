import {bar, dateKey, number, sorted} from './analysis.mjs';

export const markets = {
  TWSE: {
    name: '臺灣證券交易所',
    daily: 'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX',
    dailyInfo: 'https://data.gov.tw/dataset/11549',
    historyInfo: 'https://www.twse.com.tw/zh/trading/historical/stock-day.html'
  },
  TPEX: {
    name: '證券櫃檯買賣中心',
    daily: 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
    dailyInfo: 'https://data.gov.tw/dataset/11371',
    historyInfo: 'https://www.tpex.org.tw/zh-tw/mainboard/trading/info/stock-pricing.html'
  }
};

const names = {
  date: ['date', 'tradedate', 'datadate', '日期', '資料日期', '交易日期'],
  time: ['time', 'timestamp', '時間', '日期時間'],
  code: ['code', 'stockcode', 'securitiescompanycode', 'securitiescode', 'ticker', '證券代號', '代號', '公司代號', '股票代號'],
  name: ['name', 'stockname', 'companyname', 'securitiesname', '證券名稱', '名稱', '公司簡稱', '股票名稱'],
  open: ['open', 'openingprice', 'openprice', '開盤價', '開盤'],
  high: ['high', 'highestprice', 'highprice', '最高價', '最高'],
  low: ['low', 'lowestprice', 'lowprice', '最低價', '最低'],
  close: ['close', 'closingprice', 'closeprice', '收盤價', '收盤'],
  volume: ['volume', 'tradevolume', 'tradingshares', 'tradedshares', 'transactionshares', '成交股數', '成交量', '成交仟股', '成交千股', '成交張數'],
  amount: ['amount', 'tradevalue', 'tradingamount', 'transactionamount', 'tradeamount', '成交金額', '成交金額元', '成交仟元', '成交千元'],
  delta: ['change', 'changeprice', 'changeamount', '漲跌', '漲跌價差', '漲跌價']
};

const clean = key => String(key).toLowerCase().replace(/[\s\uFEFF_()（）]/g, '');
const validCode = value => /^[0-9A-Z]{2,8}$/.test(value);
function columnMap(headers) {
  const keys = headers.map(clean);
  return Object.fromEntries(Object.entries(names).map(([name, aliases]) =>
    [name, keys.findIndex(key => aliases.includes(key))]));
}

function reportRows(headers, values) {
  const map = columnMap(headers);
  const read = row => {
    const item = Object.fromEntries(Object.entries(map).map(([name, index]) => [name, row[index]]));
    for (const name of ['volume', 'amount']) {
      if (/[仟千張]/.test(clean(headers[map[name]]))) {
        const parsed = number(item[name]);
        item[name] = parsed == null ? null : parsed * 1000;
      }
    }
    return item;
  };
  return values.map(read);
}

export function csvRows(input) {
  const table = [];
  let row = [], value = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"' && quoted && input[i + 1] === '"') {
      value += '"';
      i++;
    } else if (char === '"' && (quoted || !value.trim())) {
      quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n' || char === '\r')) {
      row.push(value.trim());
      value = '';
      if (char === ',') continue;
      if (char === '\r' && input[i + 1] === '\n') i++;
      if (row.some(Boolean)) table.push(row);
      row = [];
    } else {
      value += char;
    }
  }
  if (quoted) throw Error('CSV 引號沒有配對。');
  row.push(value.trim());
  if (row.some(Boolean)) table.push(row);
  return table;
}

export function parseCsv(input, {code, interval}) {
  const table = csvRows(input.replace(/^\uFEFF/, ''));
  const header = table.findIndex(row => {
    const columns = columnMap(row);
    return ['open', 'high', 'low', 'close', 'volume', interval ? 'time' : 'date']
      .every(name => columns[name] >= 0);
  });
  if (header < 0) throw Error('找不到符合週期的日期／時間、開高低收與成交股數欄位。');
  const title = table.slice(0, header).flat().join(' ');
  const titleCode = title.match(/(?:^|\s)(\d[\dA-Z]{3,7})\s+\S.*(?:日成交資訊|交易資訊)/)?.[1];
  if (titleCode && titleCode !== code) throw Error('CSV 標題的個股代號與查詢欄不同。');
  const parsed = [];
  let skipped = 0;
  for (const row of reportRows(table[header], table.slice(header + 1))) {
    const rowCode = row.code?.replace(/^=/, '').replaceAll('"', '').toUpperCase();
    if (rowCode && rowCode !== code) continue;
    const item = bar({...row, time: interval ? row.time : undefined});
    if (item && (!interval || (item.minute != null && item.minute % interval === 0))) parsed.push(item);
    else skipped++;
  }
  return {rows: sorted(parsed), skipped: skipped + parsed.length - new Set(parsed.map(r => r.key)).size};
}

export function parseDaily(payload, market) {
  if (!Array.isArray(payload)) throw Error('盤後行情格式不符。');
  const first = payload.find(row => row && typeof row === 'object');
  if (!first) throw Error('來源沒有提供盤後行情。');
  const keys = Object.keys(first);
  const rows = reportRows(keys, payload.filter(Boolean).map(row => keys.map(key => row[key])));
  return latestQuotes(rows, market);
}

function latestQuotes(rows, market) {
  const quotes = rows.flatMap(row => {
    const code = String(row.code ?? '').trim().toUpperCase();
    const quote = bar(row);
    const delta = number(row.delta);
    if (!validCode(code) || !quote) return [];
    const previousClose = delta == null ? null : quote.close - delta;
    return [{...quote, code, name: String(row.name || code).trim() || code, market,
      change: previousClose > 0 ? delta / previousClose * 100 : null}];
  });
  if (!quotes.length) throw Error('來源沒有可辨識的盤後行情。');
  const date = quotes.map(quote => quote.date).sort().at(-1);
  return quotes.filter(quote => quote.date === date);
}

export function twseDailyUrl(date) {
  return markets.TWSE.daily + '?' + new URLSearchParams({
    date: date.replaceAll('-', ''), type: 'ALLBUT0999', response: 'json'
  });
}

function hasQuoteColumns(fields) {
  const columns = columnMap(fields);
  return ['code', 'open', 'high', 'low', 'close', 'volume'].every(name => columns[name] >= 0);
}

function datedQuotes(fields, values, market, date) {
  const signIndex = fields.findIndex(field => String(field).replaceAll(' ', '') === '漲跌(+/-)');
  const rows = reportRows(fields, values).map((row, i) => {
    if (signIndex < 0) return {...row, date};
    const sign = String(values[i][signIndex] ?? '').replace(/<[^>]*>/g, '').trim();
    const delta = number(row.delta);
    const signed = delta == null ? null : sign === '+' ? Math.abs(delta) : sign === '-' ? -Math.abs(delta)
      : !sign && delta === 0 ? 0 : null;
    return {...row, date, delta: signed};
  });
  return latestQuotes(rows, market);
}

export function parseTwseDaily(payload, expectedDate) {
  if (payload.stat !== 'OK') throw Error('當日沒有可用收盤報表，請改選其他交易日。');
  const date = dateKey(payload.date);
  if (date !== expectedDate) throw Error('報表日期與指定交易日不同。');
  const table = payload.tables?.find(item => Array.isArray(item.fields) && hasQuoteColumns(item.fields));
  if (!Array.isArray(table?.data)) throw Error('找不到含個股欄位的收盤報表。');
  return datedQuotes(table.fields, table.data, 'TWSE', date);
}

export function parseDailyCsv(input, market) {
  const table = csvRows(input.replace(/^\uFEFF/, ''));
  const header = table.findIndex(row => {
    const columns = columnMap(row);
    return columns.date >= 0 && hasQuoteColumns(row);
  });
  if (header >= 0) return latestQuotes(reportRows(table[header], table.slice(header + 1)), market);
  const report = table.findIndex(hasQuoteColumns);
  const title = table[report - 1]?.join(' ') ?? '';
  const parts = title.match(/(\d{2,4})年(\d{1,2})月(\d{1,2})日/);
  const date = dateKey(parts?.slice(1).join('/'));
  if (!date) throw Error('請使用含交易日期、證券代號及 OHLCV 的官方盤後清單。');
  return datedQuotes(table[report], table.slice(report + 1), market, date);
}

export function parseHistory(payload, market) {
  if (market === 'TWSE' && payload.stat !== 'OK') {
    if (/沒有符合條件|查無資料/.test(String(payload.stat))) return [];
    throw Error('證交所歷史查詢未回傳可用資料。');
  }
  const table = market === 'TWSE' ? payload : payload.tables?.[0] ?? payload;
  if (table.totalCount === 0) return [];
  if (!Array.isArray(table.fields) || !Array.isArray(table.data)) throw Error('歷史行情格式不符。');
  const columns = columnMap(table.fields);
  if (['date', 'open', 'high', 'low', 'close', 'volume'].some(name => columns[name] < 0)) {
    throw Error('歷史資料缺少必要欄位。');
  }
  return sorted(reportRows(table.fields, table.data).map(bar).filter(Boolean));
}

export function historyUrl(market, code, month, format = 'json') {
  const [year, number] = month.split('-');
  if (market === 'TWSE') {
    return 'https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?'
      + new URLSearchParams({date: year + number + '01', stockNo: code, response: format});
  }
  return 'https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?'
    + new URLSearchParams({date: year + '/' + number + '/01', code, response: format});
}

export function recentMonths(last, count) {
  const value = dateKey(last + '-01');
  if (!value) throw Error('請指定有效年月。');
  const date = new Date(value + 'T00:00:00Z');
  return Array.from({length: count}, (_, i) =>
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
}

export async function readJson(url, fetcher = fetch) {
  const response = await fetcher(url, {credentials: 'omit', signal: AbortSignal.timeout(7000)});
  if (!response.ok) throw Error('行情來源回傳 HTTP ' + response.status);
  return response.json();
}

export async function loadHistory(market, code, months, fetcher = fetch) {
  const rows = [], failed = [];
  for (const month of months) {
    try {
      const result = await readJson(historyUrl(market, code, month), fetcher);
      const data = parseHistory(result, market);
      if (data.some(row => !row.date.startsWith(month))) throw Error('來源返回不同月份。');
      rows.push(...data);
    } catch {
      failed.push(month);
      // Stop repeated requests after a network, access, or format failure.
      failed.push(...months.slice(months.indexOf(month) + 1));
      break;
    }
  }
  return {rows: sorted(rows), failed};
}

export async function readCsvFile(file) {
  if (file.size > 8_000_000) throw Error('單一 CSV 上限為 8 MB。');
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    return new TextDecoder('big5').decode(bytes);
  }
}
