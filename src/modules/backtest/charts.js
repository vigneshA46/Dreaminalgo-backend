/**
 * Chart specs for the "live" backtest view: candles, indicator lines, levels and buy / sell markers of the
 * charts a strategy used on one day (index chart and the traded options). They are built from the candles the
 * engine already has and are only shown, never stored. The page draws them itself (no chart service, no API).
 *
 * spec = {
 *   id, title, subtitle?, tf,                       tf = candle minutes
 *   candles: [{ time, end, open, high, low, close }],
 *   lines:   [{ name, color, values: [n|null ...], colors?: [c ...], dash?, step? }],   one value per candle
 *   levels:  [{ name, value, color, dash?, from?, to? }],                              from / to = "HH:MM"
 *   markers: [{ time, kind: buy | sell | exit | info, text, price?, at?: "low" | "high" }]
 * }
 */

import { minutesBetween } from "./backtest.service.js";

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const r2 = (x) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 100) / 100);

/** 1-min bars { hhmm: [o,h,l,c] } -> candles of tf minutes aligned to 09:15 */
export function aggregateBars(bars, tf, from = "09:15", to = "15:29") {
  const out = [];
  for (const hhmm of minutesBetween(from, to)) {
    const b = bars?.[hhmm];
    if (!b) continue;
    const k = Math.floor((toMin(hhmm) - toMin("09:15")) / tf);
    let c = out[out.length - 1];
    if (!c || c.k !== k) {
      c = { k, time: toHHMM(toMin("09:15") + k * tf), end: toHHMM(toMin("09:15") + (k + 1) * tf), open: b[0], high: b[1], low: b[2], close: b[3] };
      out.push(c);
    } else {
      c.high = Math.max(c.high, b[1]);
      c.low = Math.min(c.low, b[2]);
      c.close = b[3];
    }
  }
  return out.map(({ k, ...c }) => ({ time: c.time, end: c.end, open: r2(c.open), high: r2(c.high), low: r2(c.low), close: r2(c.close) }));
}

export const cleanCandles = (rows) =>
  rows.map((c) => ({ time: c.time, end: c.end, open: r2(c.open), high: r2(c.high), low: r2(c.low), close: r2(c.close) }));

/** buy / exit markers of trades on an INDEX chart (y = the candle's low / high) */
export function indexMarkers(trades) {
  const out = [];
  for (const t of trades) {
    const ce = t.side === "CE";
    out.push({ time: t.entryTime, kind: ce ? "buy" : "sell", at: ce ? "low" : "high", text: `${ce ? "BUY" : "SELL"} ${t.side} ${t.strike} @ ${t.entryPrice}` });
    out.push({ time: t.exitTime, kind: "exit", at: ce ? "high" : "low", text: `EXIT ${t.side} ${t.exitPrice} (${t.pnl >= 0 ? "+" : ""}${Math.round(t.pnl)})` });
  }
  return out;
}

/** entry / exit markers of trades on an OPTION chart (y = the traded price) */
export function optionMarkers(trades) {
  const out = [];
  for (const t of trades) {
    out.push({ time: t.entryTime, kind: "buy", price: t.entryPrice, text: `BUY @ ${t.entryPrice}` });
    out.push({ time: t.exitTime, kind: "exit", price: t.exitPrice, text: `EXIT @ ${t.exitPrice} (${t.pnl >= 0 ? "+" : ""}${Math.round(t.pnl)})` });
  }
  return out;
}

/** one chart per traded contract (side + strike), candles of tf minutes, entries / exits on it */
export function optionTradeCharts(data, trades, tf) {
  const seen = new Map();
  for (const t of trades) {
    const k = `${t.side}-${t.strike}`;
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push(t);
  }
  const charts = [];
  for (const [k, list] of seen) {
    const [side, strike] = k.split("-");
    const bars = data?.[side]?.get(Number(strike));
    if (!bars) continue;
    charts.push({
      id: `opt-${k}`,
      title: `${side} ${strike} · ${tf}-min`,
      subtitle: "traded option",
      tf,
      candles: aggregateBars(bars, tf),
      lines: [],
      levels: [],
      markers: optionMarkers(list),
    });
  }
  return charts;
}

/** index chart: candle rows with indicator values; lines = [{ name, color, key, colorKey?, colorMap? }] */
export function indexChart({ id = "index", title, subtitle, tf, rows, lines = [], levels = [], markers = [] }) {
  return {
    id,
    title,
    subtitle,
    tf,
    candles: cleanCandles(rows),
    lines: lines.map((l) => ({
      name: l.name,
      color: l.color,
      width: l.width,
      dash: l.dash,
      values: rows.map((r) => r2(r[l.key])),
      ...(l.colorKey ? { colors: rows.map((r) => (l.colorMap ? l.colorMap[r[l.colorKey]] || null : r[l.colorKey])) } : {}),
    })),
    levels,
    markers,
  };
}
