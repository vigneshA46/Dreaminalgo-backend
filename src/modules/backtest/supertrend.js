/**
 * Supertrend like TradingView ta.supertrend(factor, period): ATR is an RMA (seeded with the SMA of the first
 * `period` true ranges), bands carry over while price stays inside them.
 * dir: -1 = uptrend (buy), +1 = downtrend (sell), null until the ATR exists.
 */

export const newSt = () => ({ n: 0, trs: [], atr: null, prevClose: null, upper: null, lower: null, dir: null, value: null });

/** feed one completed candle { high, low, close }; returns { dir, prevDir, value } after it */
export function stStep(st, c, period, factor) {
  const prevDir = st.dir;
  const tr = st.prevClose === null ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - st.prevClose), Math.abs(c.low - st.prevClose));
  st.n += 1;
  if (st.n <= period) {
    st.trs.push(tr);
    st.atr = st.n === period ? st.trs.reduce((a, b) => a + b, 0) / period : null;
  } else {
    st.atr = (st.atr * (period - 1) + tr) / period;
  }
  if (st.atr === null) {
    st.prevClose = c.close;
    return { dir: null, prevDir: null, value: null };
  }
  const src = (c.high + c.low) / 2;
  let upper = src + factor * st.atr;
  let lower = src - factor * st.atr;
  if (st.lower !== null) {
    lower = lower > st.lower || st.prevClose < st.lower ? lower : st.lower;
    upper = upper < st.upper || st.prevClose > st.upper ? upper : st.upper;
  }
  let dir;
  if (st.dir === null) dir = 1;
  else if (st.dir === 1) dir = c.close > upper ? -1 : 1;
  else dir = c.close < lower ? 1 : -1;
  st.upper = upper;
  st.lower = lower;
  st.dir = dir;
  st.value = dir === -1 ? lower : upper;
  st.prevClose = c.close;
  return { dir, prevDir, value: st.value };
}
