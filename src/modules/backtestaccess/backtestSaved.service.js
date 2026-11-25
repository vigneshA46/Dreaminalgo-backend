/**
 * Saved backtests: one version per strategy + day, shared by everyone with read access.
 *   backtest_trade_legs  one row per saved day and leg (CE / PE), also for days without trades
 *   backtest_trades      ENTRY + EXIT rows linked by trade_id (like paper_trades); the EXIT row carries
 *                        pnl, cum_pnl and the full trade as JSON so a saved day renders like a fresh run
 * The server saves its OWN run results only (see backtestJobs.getSaveSource), never data sent by a browser.
 */

import { randomUUID } from "crypto";
import pool from "../../config/db.js";
import { BacktestError } from "../backtest/backtest.service.js";
import { summarize } from "../backtest/backtestRunner.js";

const LOTSIZE = 65;
// per-day fields that are big or stored elsewhere: candles, event timeline, tables rendered only on a single-day run
const NOT_IN_META = new Set(["trades", "events", "hmaCandles", "emaCandles", "indexCandles", "legCandles", "supertrend", "charts", "ce", "pe"]);
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const r2 = (x) => Math.round(Number(x || 0) * 100) / 100;

const abs = (v) => (v === null || v === undefined ? null : Math.abs(Number(v)));

/**
 * The configs a day was run with, as one JSON: the main ones by name (timeframe, strike, day SL, day MTM target ...),
 * the options as the user sent them, and every other parameter of the strategy under "params".
 */
export function buildConfigs(params, options) {
  const p = params && typeof params === "object" ? params : {};
  const o = options && typeof options === "object" ? options : null;
  const strike = typeof o?.strike === "string" ? o.strike : typeof p.strike === "string" ? p.strike.split(" from ")[0] : null;
  const main = {
    timeframeMinutes: p.candleMinutes ?? p.entryCandleMinutes ?? o?.timeframe ?? null,
    strike,
    daySl: abs(p.dayMaxLoss),
    dayMtmTarget: p.dayTarget ?? p.dayMaxProfit ?? null,
    cycleSl: abs(p.cycleMaxLoss),
    cycleProfit: p.cycleMaxProfit ?? null,
    tradeProfit: p.tradeMaxProfit ?? null,
    touchBufferPoints: p.touchBufferPoints ?? null,
    lotSize: p.lotSize ?? null,
    lots: p.lots ?? null,
    squareOff: p.tradeEnd ?? p.dayClose ?? null,
  };
  const out = Object.fromEntries(Object.entries(main).filter(([, v]) => v !== null && v !== undefined));
  if (o && Object.keys(o).length) out.options = o;
  out.params = p;
  return out;
}

const stamp = (date, hhmm) => `${date} ${hhmm || "00:00"}:00`;

/** multi-row INSERT helper: rows = array of value arrays */
async function insertRows(client, table, columns, rows, chunk = 200) {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const params = [];
    const values = part.map((row) => {
      const ph = row.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${ph.join(",")})`;
    });
    await client.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES ${values.join(",")}`, params);
  }
}

const LEG_COLS = ["strategy_key", "trade_date", "leg", "strikes", "trades", "wins", "pnl", "leg_data", "day_meta", "settings", "configs", "run_id", "saved_by"];
const TRADE_COLS = [
  "strategy_key", "trade_date", "run_id", "trade_id", "timestamp", "event_type", "leg_name", "symbol", "side",
  "lots", "quantity", "price", "reason", "pnl", "cum_pnl", "details", "saved_by",
];

function dayRows(day, key, runId, userId, settings, configs) {
  const meta = Object.fromEntries(Object.entries(day).filter(([k]) => !NOT_IN_META.has(k)));
  const legs = ["CE", "PE"].map((side) => {
    const leg = day[side.toLowerCase()] || { pnl: 0, strikes: [] };
    const mine = day.trades.filter((t) => t.side === side);
    return [
      key, day.date, side, JSON.stringify(leg.strikes || []), mine.length, mine.filter((t) => t.pnl > 0).length,
      r2(leg.pnl), JSON.stringify(leg), JSON.stringify(meta), JSON.stringify(settings || null), JSON.stringify(configs), runId, userId,
    ];
  });

  const trades = [];
  let cum = 0;
  for (const t of day.trades) {
    const tradeId = randomUUID();
    const symbol = `NIFTY ${t.strike} ${t.side}`;
    cum += Number(t.pnl) || 0;
    trades.push([key, day.date, runId, tradeId, stamp(day.date, t.entryTime), "ENTRY", t.side, symbol, "BUY",
      t.lot || 1, t.quantity || LOTSIZE, t.entryPrice, t.entryReason || null, null, null, null, userId]);
    trades.push([key, day.date, runId, tradeId, stamp(day.date, t.exitTime), "EXIT", t.side, symbol, "SELL",
      t.lot || 1, t.quantity || LOTSIZE, t.exitPrice, t.exitReason || null, r2(t.pnl), r2(cum), JSON.stringify(t), userId]);
  }
  return { legs, trades };
}

/**
 * Save the finished days of a run.
 * replace === undefined: if some of the days are already saved, change nothing and answer with the list
 * replace === true: overwrite the saved days with this run; false: keep them and save only the new days
 */
export async function saveRun({ userId, key, result, options = null, replace }) {
  const days = (result?.days || []).filter((d) => d.status === "ok");
  if (!days.length) throw new BacktestError("This run has no finished trading day to save", 400);
  const dates = days.map((d) => d.date);

  const ex = await pool.query(
    `SELECT DISTINCT trade_date::text AS d FROM backtest_trade_legs WHERE strategy_key = $1 AND trade_date = ANY($2::date[]) ORDER BY 1`,
    [key, dates]
  );
  const existing = ex.rows.map((r) => r.d);
  if (existing.length && replace === undefined) {
    return { status: "conflicts", conflicts: existing, newDays: dates.length - existing.length, total: dates.length };
  }

  const toSave = replace ? days : days.filter((d) => !existing.includes(d.date));
  if (!toSave.length) return { status: "saved", saved: 0, replaced: 0, skipped: existing.length };

  const runId = randomUUID();
  const configs = buildConfigs(result.params, options);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (replace && existing.length) {
      // the old version of these days goes away together with the insert of the new one (one transaction)
      await client.query(`DELETE FROM backtest_trades WHERE strategy_key = $1 AND trade_date = ANY($2::date[])`, [key, existing]);
      await client.query(`DELETE FROM backtest_trade_legs WHERE strategy_key = $1 AND trade_date = ANY($2::date[])`, [key, existing]);
    }
    const legRows = [];
    const tradeRows = [];
    for (const d of toSave) {
      const { legs, trades } = dayRows(d, key, runId, userId, result.params, configs);
      legRows.push(...legs);
      tradeRows.push(...trades);
    }
    await insertRows(client, "backtest_trade_legs", LEG_COLS, legRows);
    await insertRows(client, "backtest_trades", TRADE_COLS, tradeRows);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return { status: "saved", saved: toSave.length, replaced: replace ? existing.length : 0, skipped: replace ? 0 : existing.length };
}

/** saved days of a strategy rebuilt in the same shape as a range run result (so the same page can render it) */
export async function readSaved({ key, from, to }) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const lo = iso.test(from || "") ? from : null;
  const hi = iso.test(to || "") ? to : null;
  const params = [key, lo, hi];

  const legs = await pool.query(
    `SELECT l.trade_date::text AS d, l.leg, l.leg_data, l.day_meta, l.settings, l.configs, l.created_at, u.fullname AS saved_by_name
     FROM backtest_trade_legs l
     LEFT JOIN users u ON u.id = l.saved_by
     WHERE l.strategy_key = $1
       AND ($2::date IS NULL OR l.trade_date >= $2::date)
       AND ($3::date IS NULL OR l.trade_date <= $3::date)
       AND ($2::date IS NOT NULL OR $3::date IS NOT NULL OR l.trade_date >= CURRENT_DATE - 366)
     ORDER BY l.trade_date, l.leg`,
    params
  );
  const trades = await pool.query(
    `SELECT trade_date::text AS d, details FROM backtest_trades
     WHERE strategy_key = $1 AND event_type = 'EXIT'
       AND ($2::date IS NULL OR trade_date >= $2::date)
       AND ($3::date IS NULL OR trade_date <= $3::date)
       AND ($2::date IS NOT NULL OR $3::date IS NOT NULL OR trade_date >= CURRENT_DATE - 366)
     ORDER BY trade_date, timestamp, cum_pnl`,
    params
  );

  const tradesByDay = new Map();
  for (const t of trades.rows) {
    if (!tradesByDay.has(t.d)) tradesByDay.set(t.d, []);
    tradesByDay.get(t.d).push(t.details);
  }
  const byDay = new Map();
  for (const l of legs.rows) {
    if (!byDay.has(l.d)) byDay.set(l.d, {});
    byDay.get(l.d)[l.leg] = l;
  }

  const days = [];
  let cumulative = 0;
  for (const [date, sides] of [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const ce = sides.CE?.leg_data || { pnl: 0, strikes: [], trades: 0 };
    const pe = sides.PE?.leg_data || { pnl: 0, strikes: [], trades: 0 };
    const meta = sides.CE?.day_meta || sides.PE?.day_meta || {};
    const list = tradesByDay.get(date) || [];
    const dayPnl = r2(ce.pnl + pe.pnl);
    cumulative += dayPnl;
    const first = sides.CE || sides.PE;
    days.push({
      ...meta,
      date,
      day: DOW[new Date(`${date}T00:00:00Z`).getUTCDay()],
      status: "ok",
      ce,
      pe,
      dayPnl,
      cumulativePnl: r2(cumulative),
      totalTrades: list.length,
      trades: list,
      saved: { by: first.saved_by_name || null, at: first.created_at, settings: first.settings || null, configs: first.configs || buildConfigs(first.settings, null) },
    });
  }

  const sum = summarize(days, 1);
  let summary = null;
  let analysis = ["No saved days in this range."];
  if (sum) {
    summary = { ...sum.summary };
    delete summary.byPivot;
    analysis = [...sum.head, ...sum.tail.filter((x) => !x.startsWith("Best pivot"))];
  }
  const settings = days.length ? days[days.length - 1].saved.settings : null;
  return {
    success: true,
    strategy: key,
    params: { lotSize: LOTSIZE, lots: 1, candleMinutes: settings?.candleMinutes },
    summary,
    analysis,
    days,
    errors: [],
    logs: [],
    meta: {},
    savedDays: days.length,
  };
}
