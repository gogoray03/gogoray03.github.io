import {aggregateMinutes, backtest, indicators, screen, sorted} from './analysis.mjs';
import {loadHistory, markets, parseCsv, parseDaily, parseDailyCsv, parseTwseDaily, readCsvFile, readJson, recentMonths, twseDailyUrl} from './data.mjs';
import {drawChart} from './chart.mjs';

const $ = id => document.getElementById(id);
const taipei = new Intl.DateTimeFormat('zh-TW', {timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'medium'});
const dayFormat = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'});
const price = new Intl.NumberFormat('zh-TW', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const integer = new Intl.NumberFormat('zh-TW');
const fmt = (value, formatter = price) => value == null ? '—' : formatter.format(value);
const pct = value => value == null ? '—' : (value > 0 ? '+' : '') + fmt(value) + '%';
const stamp = value => taipei.format(new Date(value));
const say = (id, value) => { $(id).textContent = value; };
const numeric = id => $(id).valueAsNumber;
const periods = [...$('periods').querySelectorAll('button')];
const histories = new Map(), daily = new Map(), quotes = new Map();
const key = (market, code) => market + ':' + code;
const seriesFor = (market, code, interval) => histories.get(key(market, code))?.get(interval);
let active = null, selectedPeriod = 0, visible = null;
let watch = [];
try {
  watch = JSON.parse(localStorage.getItem('stockpulse.watch.v1') || '[]');
  watch = Array.isArray(watch) ? watch.filter(row => row && Object.hasOwn(markets, row.market)
    && /^[0-9A-Z]{2,8}$/.test(row.code)).slice(0, 100) : [];
} catch {
  watch = [];
}

const dateParts = Object.fromEntries(dayFormat.formatToParts(new Date()).map(part => [part.type, part.value]));
$('month').max = $('month').value = dateParts.year + '-' + dateParts.month;
$('month').min = '1994-01';
const today = dateParts.year + '-' + dateParts.month + '-' + dateParts.day;
$('screen-date').max = $('screen-date').value = today;

function button(label, action) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', action);
  return element;
}

function query() {
  const market = $('market').value;
  const input = $('symbol').value.trim().toUpperCase();
  const matches = (daily.get(market)?.rows ?? []).filter(row => row.name.trim().toUpperCase() === input);
  const code = /^[0-9A-Z]{2,8}$/.test(input) ? input : matches.length === 1 ? matches[0].code : null;
  if (!code) throw Error('請輸入有效股票代號，或更新盤後清單後輸入完整名稱。');
  return {market, code};
}

function updateQuery() {
  const market = $('market').value;
  $('official').href = markets[market].historyInfo;
  $('month').min = market === 'TWSE' ? '2010-01' : '1994-01';
  const list = document.createDocumentFragment();
  for (const row of daily.get(market)?.rows ?? []) {
    const option = document.createElement('option');
    option.value = row.code;
    option.label = row.name;
    list.append(option);
  }
  $('symbols').replaceChildren(list);
}

function selectInstrument(instrument, interval = 0) {
  active = instrument;
  selectedPeriod = interval;
  $('market').value = instrument.market;
  $('symbol').value = instrument.code;
  updateQuery();
  renderInstrument();
  say('backtest-status', '');
  $('backtest-table').replaceChildren();
}

function labelFor({market, code}) {
  const name = quotes.get(key(market, code))?.name;
  return name && name !== code ? code + ' ' + name : code;
}

function showWatch() {
  const items = watch.map(instrument => {
    const item = document.createElement('li');
    const select = button(labelFor(instrument) + ' · ' + instrument.market, () => {
      selectInstrument(instrument);
      if (!seriesFor(instrument.market, instrument.code, 0) && !$('search-button').disabled) $('lookup').requestSubmit();
    });
    const remove = button('移除', () => {
      watch = watch.filter(row => key(row.market, row.code) !== key(instrument.market, instrument.code));
      saveWatch();
    });
    remove.setAttribute('aria-label', '移除 ' + instrument.code);
    item.append(select, remove);
    return item;
  });
  $('watchlist').replaceChildren(...items);
}

function saveWatch() {
  try { localStorage.setItem('stockpulse.watch.v1', JSON.stringify(watch)); }
  catch { say('lookup-status', '此瀏覽器禁止本機儲存，自選股僅保留在本次開啟期間。'); }
  showWatch();
  renderScreen();
}

function getSeries(instrument, interval) {
  if (!instrument) return null;
  const {market, code} = instrument;
  const direct = seriesFor(market, code, interval);
  if (direct) return direct;
  if (!interval) return null;
  const minute = seriesFor(market, code, 1);
  if (!minute) return null;
  const rows = aggregateMinutes(minute.rows, interval);
  return rows.length ? {...minute, rows, derived: true} : null;
}

function setSeries({market, code}, interval, data) {
  const id = key(market, code);
  if (!histories.has(id)) histories.set(id, new Map());
  histories.get(id).set(interval, data);
}

function renderInstrument() {
  const available = new Map(periods.map(item => {
    const interval = Number(item.dataset.period);
    return [interval, getSeries(active, interval)];
  }));
  for (const item of periods) {
    const interval = Number(item.dataset.period);
    item.disabled = interval !== 0 && !available.get(interval)?.rows.length;
    item.setAttribute('aria-pressed', interval === selectedPeriod);
  }
  const history = available.get(selectedPeriod);
  const rows = history ? indicators(history.rows, selectedPeriod) : [];
  const last = rows.at(-1);
  visible = last ? {...history, rows} : null;
  say('instrument', active ? labelFor(active) + ' · ' + active.market : '尚未載入個股');
  say('meta', last
    ? [history.source, history.mode, '行情截至 ' + last.key.replace('T', ' ') + (selectedPeriod ? '（台北・K 棒起始）' : '（交易日）'),
      '取得／匯入 ' + stamp(history.loadedAt) + '（台北）'].join(' · ')
    : '盤後／歷史來源。第一版尚無即時行情來源。');
  say('close', fmt(last?.close));
  say('volume', fmt(last?.volume, integer));
  say('change', pct(last?.change));
  $('change').className = last?.change > 0 ? 'up' : last?.change < 0 ? 'down' : '';
  say('vwap', fmt(last?.vwap));
  say('macd', last?.dif == null ? '—' : [last.dif, last.signal, last.histogram].map(value => fmt(value)).join(' / '));
  say('kd', last?.k == null ? '—' : fmt(last.k) + ' / ' + fmt(last.d));
  say('rsi', fmt(last?.rsi));
  say('chart-caption', last
    ? `共 ${rows.length} 根，圖表顯示最近最多 90 根。指標需累積足夠 K 棒。`
      + (selectedPeriod ? ' VWAP 需要自 09:00 起連續且具成交量值。' : ' 分鐘 K 需另行匯入。')
      + (history.derived ? ' 由 1 分 K 合成，略過不完整區間。' : '')
    : '分鐘 K 需匯入符合週期的資料。');
  $('chart-empty').hidden = Boolean(last);
  $('copy').disabled = $('snapshot').disabled = !last;
  $('run-bt').disabled = (available.get(0)?.rows.length ?? 0) < 3;
  say('snapshot-status', '');
  drawChart($('chart'), rows);
}

function updateDaily(market, rows, type) {
  const previous = daily.get(market);
  for (const row of previous?.rows ?? []) quotes.delete(key(market, row.code));
  for (const row of rows) quotes.set(key(market, row.code), row);
  daily.set(market, {rows, type, loadedAt: new Date().toISOString()});
}

function updateDailyUI(failures = []) {
  updateQuery();
  showWatch();
  renderInstrument();
  renderScreen();
  const status = [...daily.entries()].map(([market, data]) =>
    `${market} 交易日 ${data.rows[0].date}，${data.type} ${stamp(data.loadedAt)}`);
  say('screen-status', [...status, ...failures].join(' · '));
}

function tableRow(cells) {
  const row = document.createElement('tr');
  for (const value of cells) {
    const cell = document.createElement('td');
    if (typeof value === 'string') cell.textContent = value;
    else cell.append(value);
    row.append(cell);
  }
  return row;
}

function renderScreen() {
  const market = $('universe').value;
  const instruments = market === 'watch' ? watch : daily.get(market)?.rows ?? [];
  const input = instruments.flatMap(item => {
    const id = key(item.market, item.code);
    const quote = quotes.get(id);
    const history = seriesFor(item.market, item.code, 0);
    const last = history ? indicators(history.rows).at(-1) : null;
    if (quote) {
      const comparable = last?.date === quote.date && last.volume === quote.volume && last.close === quote.close;
      return [{...quote, relative: comparable ? last.relative : null}];
    }
    return last ? [{...last, market: item.market, code: item.code}] : [];
  });
  const matches = screen(input, {minVolume: numeric('min-volume'), minChange: numeric('min-change'), minRelative: numeric('min-relative')});
  say('screen-count', `符合 ${matches.length} 檔／有資料 ${input.length} 檔`
    + (matches.length > 100 ? '，顯示前 100 檔' : ''));
  $('screen-table').replaceChildren(...matches.slice(0, 100).map(row => tableRow([
    button(labelFor(row) + ' · ' + row.market, () => {
      selectInstrument(row);
      if (!seriesFor(row.market, row.code, 0) && !$('search-button').disabled) $('lookup').requestSubmit();
    }),
    row.date, fmt(row.close), pct(row.change), fmt(row.volume, integer), row.relative == null ? '—' : fmt(row.relative) + '×'
  ])));
}

$('market').addEventListener('change', updateQuery);
$('lookup').addEventListener('submit', async event => {
  event.preventDefault();
  $('search-button').disabled = true;
  try {
    const instrument = query();
    const {market, code} = instrument;
    const months = recentMonths($('month').value, Number($('months').value));
    say('lookup-status', '正在向官方來源查詢日 K…');
    const {rows, failed} = await loadHistory(market, code, months);
    if (!rows.length) throw Error(failed.length ? '本次無法取得官方歷史資料，可從官方頁面下載 CSV 後匯入。' : '所選月份找不到有成交的日 K。');
    setSeries(instrument, 0, {rows, mode: '盤後／歷史', source: markets[market].name + ' 個股日成交資訊',
      url: markets[market].historyInfo, loadedAt: new Date().toISOString(), unavailableMonths: failed});
    selectInstrument(instrument);
    say('lookup-status', `載入 ${rows.length} 根日 K。` + (failed.length ? ' 部分月份未取得：' + failed.join('、') : ''));
    renderScreen();
  } catch (error) {
    say('lookup-status', error.message);
  } finally {
    $('search-button').disabled = false;
  }
});

$('watch-add').addEventListener('click', () => {
  try {
    const instrument = query();
    if (watch.some(item => key(item.market, item.code) === key(instrument.market, instrument.code))) return;
    if (watch.length >= 100) throw Error('自選股上限為 100 檔。');
    watch.push(instrument);
    saveWatch();
  } catch (error) { say('lookup-status', error.message); }
});

$('import-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('button');
  submit.disabled = true;
  try {
    const instrument = query();
    const interval = Number($('import-period').value);
    const source = $('import-source').value.trim();
    const files = [...$('csv').files];
    if (!source || !files.length || files.length > 24) throw Error('請填寫出處並選擇 1 至 24 個 CSV。');
    if (files.reduce((sum, file) => sum + file.size, 0) > 30_000_000) throw Error('每批 CSV 總計最多 30 MB。');
    const imported = [];
    let skipped = 0;
    for (const file of files) {
      const part = parseCsv(await readCsvFile(file), {...instrument, interval});
      imported.push(...part.rows);
      skipped += part.skipped;
    }
    const rows = sorted(imported);
    if (!rows.length) throw Error('CSV 沒有符合股票代號及週期的有效資料。');
    if (rows.length > 150000) throw Error('一次最多匯入 150,000 根 K 棒。');
    setSeries(instrument, interval, {rows, mode: '使用者匯入／歷史快照', source, loadedAt: new Date().toISOString()});
    selectInstrument(instrument, interval);
    say('import-status', `匯入 ${rows.length} 根有效 K 棒，略過 ${skipped + imported.length - rows.length} 列無效或重複資料。`);
    renderScreen();
  } catch (error) { say('import-status', error.message); }
  finally { submit.disabled = false; }
});

for (const period of periods) period.addEventListener('click', () => {
  selectedPeriod = Number(period.dataset.period);
  renderInstrument();
});

$('refresh-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('refresh').disabled = true;
  say('screen-status', '正在查詢上市及上櫃官方盤後清單…');
  const date = $('screen-date').value;
  const result = await Promise.allSettled([
    readJson(twseDailyUrl(date)).then(payload => updateDaily('TWSE', parseTwseDaily(payload, date), '證交所收盤報表取得於')),
    readJson(markets.TPEX.daily).then(payload => updateDaily('TPEX', parseDaily(payload, 'TPEX'), '櫃買中心 API 取得於'))
  ]);
  const failures = result.flatMap((item, i) => {
    if (item.status === 'fulfilled') return [];
    if (!i && item.reason.message.includes('交易日')) return ['TWSE：' + item.reason.message];
    return [(i ? 'TPEX' : 'TWSE') + ' 更新未成功，可匯入官方清單 CSV。'];
  });
  updateDailyUI(failures);
  $('refresh').disabled = false;
});

$('daily-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('button');
  submit.disabled = true;
  try {
    const market = $('daily-market').value;
    const file = $('daily-csv').files[0];
    updateDaily(market, parseDailyCsv(await readCsvFile(file), market), '官方清單 CSV 匯入於');
    updateDailyUI();
  } catch (error) { updateDailyUI([error.message]); }
  finally { submit.disabled = false; }
});

$('filter').addEventListener('submit', event => {
  event.preventDefault();
  renderScreen();
});

$('backtest-form').addEventListener('submit', event => {
  event.preventDefault();
  const history = getSeries(active, 0);
  const start = $('backtest-start').value, end = $('backtest-end').value;
  $('backtest-table').replaceChildren();
  if (start && end && start > end) {
    say('backtest-status', '起始日不可晚於結束日。');
    return;
  }
  const rows = indicators(history.rows);
  const result = backtest(rows, {minChange: numeric('bt-change'), minRelative: numeric('bt-relative'),
    hold: numeric('hold'), costBps: numeric('cost'), start, end});
  const scope = `${labelFor(active)} 日 K ${rows[0].date} 至 ${rows.at(-1).date}。`;
  say('backtest-status', scope + (result.trades.length
    ? `${result.trades.length} 筆完成交易 · 累計 ${pct(result.total * 100)} · 勝率 ${fmt(result.winRate * 100)}% · 已平倉最大回撤 ${pct(result.drawdown * 100)}`
    : '此期間無完成交易。相對量條件需至少 20 根前序 K 棒。'));
  $('backtest-table').replaceChildren(...result.trades.slice(-100).reverse().map(trade => tableRow([
    trade.signal, trade.entry, trade.exit, fmt(trade.buy), fmt(trade.sell), pct(trade.net * 100)
  ])));
});

function snapshot() {
  const {rows, ...provenance} = visible;
  return JSON.stringify({
    version: 1, ...active, name: labelFor(active), ...provenance, realtime: false, timezone: 'Asia/Taipei',
    interval: selectedPeriod ? selectedPeriod + 'm' : '1d', dataAsOf: rows.at(-1).key,
    generatedAt: new Date().toISOString(), observedBars: rows.length, bars: rows.slice(-30),
    notes: ['指標 null 表示資料不足或不適用。', '以提供的 K 棒為已知資料，禁止補造即時報價。']
  }, null, 2);
}

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(snapshot());
    say('snapshot-status', '已複製，可貼到 ChatGPT。');
  } catch { say('snapshot-status', '瀏覽器未允許剪貼簿存取，請下載 JSON。'); }
});

$('snapshot').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([snapshot()], {type: 'application/json'}));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `stockpulse-${active.code}-${selectedPeriod || 'daily'}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  say('snapshot-status', '已送出 JSON 下載。');
});

new ResizeObserver(() => drawChart($('chart'), visible?.rows ?? [])).observe($('chart'));
updateQuery();
showWatch();
renderInstrument();
renderScreen();
