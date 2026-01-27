let pv = 0;
let vol = 0;

export function calculateVWAP(candle) {
  const tp = (candle.high + candle.low + candle.close) / 3;
  pv += tp * candle.volume;
  vol += candle.volume;
  return pv / vol;
}
