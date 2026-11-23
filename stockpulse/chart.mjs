const colors = {muted: '#aebdc9', grid: '#2c3944', up: '#ff938e', down: '#71d8ad',
  aqua: '#9ee5e0', yellow: '#f6ca84', violet: '#c6abff'};
const format = new Intl.NumberFormat('zh-TW', {maximumFractionDigits: 2});

export function drawChart(canvas, allRows) {
  const context = canvas.getContext('2d');
  const {width, height} = canvas.getBoundingClientRect();
  if (!width || !height) return;
  const density = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * density);
  canvas.height = Math.round(height * density);
  context.scale(density, density);
  if (!allRows.length) return;

  const rows = allRows.slice(-Math.min(90, Math.floor(width / 5)));
  const left = 10, right = width - 64;
  const step = (right - left) / rows.length;
  const x = i => left + step * (i + .5);
  const bodyWidth = Math.max(1, Math.min(10, step * .66));
  const bottom = height - 27;
  let cursor = 5;
  context.font = '12px system-ui';

  function panel(label, share, low, high, ticks = 1) {
    const top = cursor + 19, end = cursor + bottom * share - 4;
    const y = value => end - (value - low) / (high - low || 1) * (end - top);
    context.fillStyle = colors.muted;
    context.fillText(label, left, top - 5);
    for (let i = 0; i <= ticks; i++) {
      const value = low + (high - low) * i / ticks;
      context.beginPath();
      context.strokeStyle = colors.grid;
      context.moveTo(left, y(value));
      context.lineTo(right, y(value));
      context.stroke();
      context.fillText(format.format(value), right + 4, y(value) + 4);
    }
    cursor += bottom * share;
    return y;
  }

  function line(key, y, color) {
    context.beginPath();
    context.strokeStyle = color;
    context.lineWidth = 1.4;
    let connected = false;
    rows.forEach((row, i) => {
      if (row[key] == null || (key === 'vwap' && i && row.date !== rows[i - 1].date)) connected = false;
      if (row[key] == null) return;
      if (connected) context.lineTo(x(i), y(row[key]));
      else context.moveTo(x(i), y(row[key]));
      connected = true;
    });
    context.stroke();
    context.lineWidth = 1;
  }

  const highs = rows.flatMap(row => [row.high, row.vwap ?? row.high]);
  const lows = rows.flatMap(row => [row.low, row.vwap ?? row.low]);
  const low = Math.min(...lows), high = Math.max(...highs);
  const padding = Math.max((high - low) * .06, high * .002);
  const yPrice = panel('K 線 · VWAP 黃線', .46, low - padding, high + padding, 3);
  rows.forEach((row, i) => {
    context.strokeStyle = context.fillStyle = row.close >= row.open ? colors.up : colors.down;
    context.beginPath();
    context.moveTo(x(i), yPrice(row.high));
    context.lineTo(x(i), yPrice(row.low));
    context.stroke();
    context.fillRect(x(i) - bodyWidth / 2, Math.min(yPrice(row.open), yPrice(row.close)),
      bodyWidth, Math.max(1, Math.abs(yPrice(row.open) - yPrice(row.close))));
  });
  line('vwap', yPrice, colors.yellow);

  const maxVolume = Math.max(1, ...rows.map(row => row.volume));
  const yVolume = panel('成交量（千股）', .14, 0, maxVolume / 1000);
  rows.forEach((row, i) => {
    context.fillStyle = row.close >= row.open ? colors.up : colors.down;
    context.fillRect(x(i) - bodyWidth / 2, yVolume(row.volume / 1000), bodyWidth,
      yVolume(0) - yVolume(row.volume / 1000));
  });

  const macd = Math.max(.01, ...rows.flatMap(row =>
    [row.dif, row.signal, row.histogram].map(value => Math.abs(value ?? 0))));
  const yMacd = panel('MACD · DIF / 訊號線', .15, -macd, macd);
  rows.forEach((row, i) => {
    if (row.histogram == null) return;
    context.fillStyle = row.histogram >= 0 ? colors.up : colors.down;
    context.fillRect(x(i) - bodyWidth / 2, Math.min(yMacd(0), yMacd(row.histogram)),
      bodyWidth, Math.abs(yMacd(0) - yMacd(row.histogram)));
  });
  line('dif', yMacd, colors.aqua);
  line('signal', yMacd, colors.yellow);
  const yKd = panel('KD · K / D', .125, 0, 100);
  line('k', yKd, colors.aqua);
  line('d', yKd, colors.yellow);
  const yRsi = panel('RSI', .125, 0, 100);
  line('rsi', yRsi, colors.violet);

  const label = row => row.minute == null ? row.date.slice(5) : row.key.slice(5).replace('T', ' ');
  context.fillStyle = colors.muted;
  context.fillText(label(rows[0]), left, height - 7);
  if (rows.length > 1) {
    const end = label(rows.at(-1));
    context.fillText(end, right - context.measureText(end).width, height - 7);
  }
}
