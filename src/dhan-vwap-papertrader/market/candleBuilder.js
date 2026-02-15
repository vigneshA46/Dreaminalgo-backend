let current = null;
export const candles = [];

export function updateCandle(tick) {
  const minute = Math.floor(tick.ltt / 60) * 60;

  if (!current || current.time !== minute) {
    if (current) candles.push(current);

    current = {
      time: minute,
      open: tick.ltp,
      high: tick.ltp,
      low: tick.ltp,
      close: tick.ltp,
      volume: tick.volume
    };
  } else {
    current.high = Math.max(current.high, tick.ltp);
    current.low = Math.min(current.low, tick.ltp);
    current.close = tick.ltp;
    current.volume = tick.volume;
  }
}
 