import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {aggregateMinutes, backtest, bar, dateKey, indicators, screen} from './analysis.mjs';
import {loadHistory, parseCsv, parseDaily, parseDailyCsv, parseHistory, parseTwseDaily, recentMonths} from './data.mjs';

const historyFields = ['日期', '成交股數', '成交金額', '開盤價', '最高價', '最低價', '收盤價'];
const sample = ['115/11/03', '200,000', '20,000,000', '100', '101', '99', '100'];

test('validates ROC dates and rejects missing or invalid OHLCV', () => {
  assert.equal(dateKey('1151103'), '2026-11-03');
  assert.equal(dateKey('115/02/30'), null);
  assert.equal(dateKey('20260229'), null);
  assert.equal(bar({date: '2026-11-03', open: 100, high: 101, low: 99, close: 102, volume: 100}), null);
});

test('parses both official daily formats and preserves source trading date', () => {
  const listed = {Date: '1151103', Code: '2330', Name: '台積電', OpeningPrice: '100', HighestPrice: '101',
    LowestPrice: '99', ClosingPrice: '100', TradeVolume: '200,000', TradeValue: '20,000,000', Change: '+2'};
  const quotes = parseDaily([listed, {...listed, Date: '1151102'}], 'TWSE');
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].name, '台積電');
  assert.equal(quotes[0].date, '2026-11-03');
  assert.equal(quotes[0].change, 2 / 98 * 100);
  const [otc] = parseDaily([{Date: '1151103', SecuritiesCompanyCode: '6488', CompanyName: '環球晶',
    Open: '100', High: '101', Low: '99', Close: '100', TradingShares: '25,000', TransactionAmount: '2,500,000', Change: '--'}], 'TPEX');
  assert.equal(otc.volume, 25000);
  assert.equal(otc.change, null);
  assert.equal(parseDailyCsv('資料日期,代號,名稱,開盤,最高,最低,收盤,成交股數,漲跌\n1151103,6488,環球晶,100,101,99,100,25000,+2', 'TPEX')[0].code, '6488');
});

test('parses official TWSE and TPEx history; converts thousands to shares and dollars', () => {
  const [twse] = parseHistory({stat: 'OK', fields: historyFields, data: [sample]}, 'TWSE');
  const [tpex] = parseHistory({tables: [{fields: ['日 期', '成交仟股', '成交仟元', '開盤', '最高', '最低', '收盤'],
    data: [['115/11/03', '200', '20,000', '100', '101', '99', '100']]}]}, 'TPEX');
  assert.deepEqual(twse, tpex);
  assert.deepEqual(recentMonths('2026-02', 3), ['2026-02', '2026-01', '2025-12']);
});

test('dated TWSE reports preserve signed changes and reject a stale report', () => {
  const fields = ['證券代號', '證券名稱', ...historyFields.slice(1), '漲跌(+/-)', '漲跌價差'];
  const row = ['2330', '台積電', ...sample.slice(1), '<span>-</span>', '2.00'];
  const payload = {stat: 'OK', date: '20261103', tables: [{fields: ['指數']}, {fields, data: [row]}]};
  const [quote] = parseTwseDaily(payload, '2026-11-03');
  assert.equal(quote.change, -2 / 102 * 100);
  assert.throws(() => parseTwseDaily(payload, '2026-11-04'), /不同/);
  const csv = '115年11月03日 每日收盤行情\n' + fields.join(',') + '\n'
    + row.map(value => '"' + value + '"').join(',');
  assert.deepEqual(parseDailyCsv(csv, 'TWSE'), [quote]);
});

test('history requests refuse wrong-month responses and stop on access/navigation failures', async () => {
  const urls = [];
  const fetcher = async url => {
    urls.push(url);
    return {ok: true, json: async () => ({stat: 'OK', fields: historyFields, data: [sample]})};
  };
  const result = await loadHistory('TWSE', '2330', ['2026-11', '2026-10', '2026-09'], fetcher);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.failed, ['2026-10', '2026-09']);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /date=20261101&stockNo=2330/);
});

test('CSV fallback validates stock, imports quoted fields and deduplicates rows', () => {
  const csv = '\uFEFF115年11月 2330 台積電 各日成交資訊\r\n' + historyFields.join(',') + '\r\n'
    + sample.map(value => '"' + value + '"').join(',');
  assert.throws(() => parseCsv(csv, {code: '2317', interval: 0}), /代號/);
  const {rows} = parseCsv(csv, {code: '2330', interval: 0});
  assert.equal(rows[0].volume, 200000);
});

const minute = (n, amount = 1000) => bar({
  time: '2026-11-03 09:' + String(n).padStart(2, '0'),
  open: 100, high: 110, low: 99, close: 101, volume: 10, amount
});

test('only complete native minute windows are aggregated and VWAP requires contiguous turnover', () => {
  const rows = [minute(0), minute(1, 1100), minute(2, 1200), minute(4), minute(5)];
  const agg = aggregateMinutes(rows, 3);
  assert.equal(agg.length, 1);
  assert.equal(agg[0].amount, 3300);
  assert.equal(indicators(agg, 3)[0].vwap, 110);
  assert.equal(indicators(rows, 1)[3].vwap, null);
  assert.equal(indicators([minute(0, null)], 1)[0].vwap, null);
  assert.equal(indicators(agg)[0].vwap, null);
  assert.deepEqual(aggregateMinutes(rows, 5), []);
  assert.deepEqual(aggregateMinutes(rows, 15), []);
  const csv = 'time,open,high,low,close,volume,amount\n2026-11-03 09:00,100,110,99,101,10,1000';
  assert.equal(parseCsv(csv, {code: '2330', interval: 1}).rows.length, 1);
  assert.throws(() => parseCsv(csv, {code: '2330', interval: 0}), /欄位/);
});

function increasing(length) {
  return Array.from({length}, (_, i) => bar({
    date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
    open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 10
  }));
}

test('MACD, KD, RSI and relative volume have explicit warm-up periods', () => {
  const rows = indicators(increasing(40));
  assert.equal(rows[7].k, null);
  assert.ok(Number.isFinite(rows[8].d));
  assert.equal(rows[13].rsi, null);
  assert.equal(rows[14].rsi, 100);
  assert.equal(rows[19].relative, null);
  assert.equal(rows[20].relative, 1);
  assert.equal(rows[24].dif, null);
  assert.equal(rows[25].dif, 7);
  assert.equal(rows[32].histogram, null);
  assert.equal(rows[33].histogram, 0);
  assert.equal(screen(rows, {minVolume: 10, minChange: 0, minRelative: 1}).length, 20);
});

test('backtest uses next open, charges both sides, and never overlaps or closes past end', () => {
  const rows = indicators(increasing(12));
  const result = backtest(rows, {minChange: 0, minRelative: 0, hold: 2, costBps: 50, end: '2026-01-09'});
  assert.equal(result.trades.length, 2);
  assert.deepEqual(result.trades[0], {signal: '2026-01-02', entry: '2026-01-03',
    exit: '2026-01-05', buy: 102, sell: 104, net: 104 * .995 / (102 * 1.005) - 1});
  assert.ok(result.trades[1].entry > result.trades[0].exit);
});

test('static entry points and app element references exist', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('./app.mjs', import.meta.url), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  for (const match of app.matchAll(/(?:\$|say|numeric)\('([^']+)'/g)) assert.ok(ids.has(match[1]), match[1]);
  for (const file of ['style.css', 'app.mjs']) {
    assert.ok(html.includes('./' + file));
    assert.ok(readFileSync(new URL('./' + file, import.meta.url)).length > 0);
  }
});
