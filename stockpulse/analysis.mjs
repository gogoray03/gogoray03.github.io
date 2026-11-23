export function number(value) {
  if (value == null || !String(value).trim()) return null;
  const cleaned = String(value).trim().replaceAll(',', '').replace('−', '-');
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(cleaned) && Number.isFinite(+cleaned)
    ? +cleaned : null;
}

export function dateKey(value) {
  const input = String(value ?? '').trim();
  const parts = input.match(/^(\d{2,4})[-/](\d{1,2})[-/](\d{1,2})$/)
    ?? input.match(/^(\d{2,4})(\d{2})(\d{2})$/);
  if (!parts) return null;
  const year = +parts[1] + (parts[1].length < 4 ? 1911 : 0);
  const iso = [year, parts[2].padStart(2, '0'), parts[3].padStart(2, '0')].join('-');
  const parsed = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

export function bar({date, time, open, high, low, close, volume, amount}) {
  const day = time ? dateKey(String(time).slice(0, 10)) : dateKey(date);
  const clock = time ? String(time).match(/^\d{4}-\d{2}-\d{2}[T ]([01]\d|2[0-3]):([0-5]\d)(?::00)?(?:\+08:00)?$/) : null;
  const [o, h, l, c, v, a] = [open, high, low, close, volume, amount].map(number);
  if (!day || (time && !clock) || [o, h, l, c].some(x => x == null || x <= 0)
    || v == null || !Number.isSafeInteger(v) || v < 0
    || h < Math.max(o, c, l) || l > Math.min(o, c)) return null;
  const minute = clock ? +clock[1] * 60 + +clock[2] : null;
  return {date: day, key: clock ? day + 'T' + clock[1] + ':' + clock[2] : day,
    minute, open: o, high: h, low: l, close: c, volume: v,
    amount: a != null && a >= 0 && (!v || a > 0) ? a : null};
}

export const sorted = rows => [...new Map(rows.map(row => [row.key, row])).values()]
  .sort((a, b) => a.key.localeCompare(b.key));

export function aggregateMinutes(rows, interval) {
  if (interval === 1) return rows;
  const groups = new Map();
  for (const row of rows) {
    const minute = Math.floor(row.minute / interval) * interval;
    const key = row.date + 'T' + String(Math.floor(minute / 60)).padStart(2, '0')
      + ':' + String(minute % 60).padStart(2, '0');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const result = [];
  for (const [key, group] of groups) {
    const first = group[0];
    const last = group.at(-1);
    if (group.length !== interval || first.minute % interval || last.minute - first.minute !== interval - 1) continue;
    result.push({...first, key, close: last.close,
      high: Math.max(...group.map(row => row.high)), low: Math.min(...group.map(row => row.low)),
      volume: group.reduce((sum, row) => sum + row.volume, 0),
      amount: group.every(row => row.amount != null) ? group.reduce((sum, row) => sum + row.amount, 0) : null});
  }
  return result;
}

function ema(values, period) {
  const result = Array(values.length).fill(null);
  let count = 0, sum = 0, last = null;
  for (const [i, value] of values.entries()) {
    if (value == null) continue;
    count++;
    if (count <= period) {
      sum += value;
      if (count === period) last = sum / period;
    } else {
      last += (value - last) * 2 / (period + 1);
    }
    result[i] = last;
  }
  return result;
}

export function indicators(rows, interval = 0) {
  const closes = rows.map(row => row.close);
  const fast = ema(closes, 12), slow = ema(closes, 26);
  const dif = slow.map((value, i) => value == null ? null : fast[i] - value);
  const signal = ema(dif, 9);
  let k = 50, d = 50, gain = 0, loss = 0;
  let amount = 0, volume = 0, previous = null, vwapValid = false;
  return rows.map((row, i) => {
    let rsi = null;
    if (i) {
      const delta = row.close - rows[i - 1].close;
      gain = gain * (i > 14 ? 13 / 14 : 1) + Math.max(0, delta) / 14;
      loss = loss * (i > 14 ? 13 / 14 : 1) + Math.max(0, -delta) / 14;
      if (i >= 14) rsi = gain + loss === 0 ? 50 : 100 * gain / (gain + loss);
    }
    if (i >= 8) {
      const window = rows.slice(i - 8, i + 1);
      const low = Math.min(...window.map(r => r.low));
      const high = Math.max(...window.map(r => r.high));
      k = (2 * k + (high === low ? 50 : 100 * (row.close - low) / (high - low))) / 3;
      d = (2 * d + k) / 3;
    }
    let vwap = null;
    if (interval) {
      if (previous?.date !== row.date) {
        amount = volume = 0;
        vwapValid = row.minute === 9 * 60;
      } else if (row.minute - previous.minute !== interval) {
        vwapValid = false;
      }
      if (row.amount == null && row.volume !== 0) vwapValid = false;
      amount += row.amount ?? 0;
      volume += row.volume;
      if (vwapValid && volume) vwap = amount / volume;
    }
    previous = row;
    const avgVolume = i >= 20 ? rows.slice(i - 20, i).reduce((sum, r) => sum + r.volume, 0) / 20 : 0;
    return {...row, dif: dif[i], signal: signal[i], histogram: signal[i] == null ? null : dif[i] - signal[i],
      k: i >= 8 ? k : null, d: i >= 8 ? d : null, rsi, vwap, relative: avgVolume ? row.volume / avgVolume : null,
      change: i ? (row.close / closes[i - 1] - 1) * 100 : null};
  });
}

export function screen(rows, {minVolume, minChange, minRelative}) {
  return rows.filter(row => row.volume >= minVolume && row.change != null && row.change >= minChange
    && (!minRelative || (row.relative != null && row.relative >= minRelative)))
    .sort((a, b) => b.change - a.change || b.volume - a.volume);
}

export function backtest(rows, {minChange, minRelative, hold, costBps, start = '', end = ''}) {
  const trades = [];
  let equity = 1, peak = 1, drawdown = 0;
  const cost = costBps / 10000;
  for (let i = 0; i + 1 + hold < rows.length; i++) {
    const signal = rows[i];
    const entry = rows[i + 1];
    const exit = rows[i + 1 + hold];
    if (signal.date < start || (end && exit.date > end) || !signal.volume || !entry.volume || !exit.volume
      || signal.change == null || signal.change < minChange
      || (minRelative && (signal.relative == null || signal.relative < minRelative))) continue;
    const net = exit.open * (1 - cost) / (entry.open * (1 + cost)) - 1;
    equity *= 1 + net;
    peak = Math.max(peak, equity);
    drawdown = Math.min(drawdown, equity / peak - 1);
    trades.push({signal: signal.date, entry: entry.date, exit: exit.date, buy: entry.open, sell: exit.open, net});
    i += hold;
  }
  return {trades, total: equity - 1, drawdown,
    winRate: trades.length ? trades.filter(t => t.net > 0).length / trades.length : null};
}
