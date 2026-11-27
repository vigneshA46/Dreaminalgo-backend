/**
 * Day loop + report shared by the 1-lot pivot backtests
 * (pivotBuffer.service.js, pivotFixedTarget.service.js, levelBreakout.service.js).
 *
 * A strategy only provides its DaySim subclass and a few analysis lines:
 *   runDays(input, SimClass)  -> { days, errors, logs, meta }
 *   summarize(days)           -> { summary, trades, inr } common stats
 */

import {
  BacktestError,
  round,
  addDays,
  isWeekend,
  dowName,
  RunLog,
  DhanData,
  isExpiryDay,
  prevTradingDay,
} from "./backtest.service.js";
import { optionTradeCharts } from "./charts.js";

function legReport(leg) {
  return {
    pnl: round(leg.pnl),
    strikes: leg.strikesUsed,
    strikeChanges: Math.max(leg.strikesUsed.length - 1, 0),
    firstPivots: leg.firstLevels ? Object.fromEntries(leg.firstLevels) : null,
    trades: 0,
    targets: 0,
    stopLosses: 0,
    ...(leg.maxLot !== undefined ? { maxLot: leg.maxLot } : {}),
  };
}

export async function runDays(input, SimClass, label, hooks = {}) {
  const started = Date.now();
  const log = new RunLog();
  const dh = new DhanData({ clientId: input.clientId, accessToken: input.accessToken, log });

  log.info(`${label} backtest ${input.fromDate} -> ${input.toDate}`);

  const days = [];
  const errors = [];
  let cumulative = 0;

  const snapshot = () => {
    const tradingDays = days.filter((d) => d.status !== "holiday");
    return {
      success: !(tradingDays.length > 0 && tradingDays.every((d) => d.status === "error")),
      days,
      errors,
      logs: log.entries,
      meta: {
        apiCalls: dh.calls,
        durationSec: round((Date.now() - started) / 1000, 1),
        dataSource: "Dhan /v2/charts/rollingoption (expired options, 1-min, ATM±10)",
      },
    };
  };

  // background jobs: progress / partial results after every day, and a way to stop early
  let totalDays = 0;
  for (let d = input.fromDate; d <= input.toDate; d = addDays(d, 1)) if (!isWeekend(d)) totalDays += 1;
  let doneDays = 0;
  let cancelled = false;
  let dailyAll = null;

  for (let day = input.fromDate; day <= input.toDate; day = addDays(day, 1)) {
    if (isWeekend(day)) continue;
    if (input.onUpdate && hooks.assemble) input.onUpdate({ result: hooks.assemble(snapshot()), progress: { done: doneDays, total: totalDays, date: day } });
    if (input.isCancelled?.()) {
      cancelled = true;
      log.warn("stopped by the user");
      break;
    }
    doneDays += 1;
    const rec = { date: day, day: dowName(day) };

    let today;
    let prev;
    let index = null;
    let history = null;
    let daily = null;
    try {
      const calls0 = dh.calls;
      today = await dh.day(day, 1);
      if (today.holiday) {
        days.push({ ...rec, status: "holiday", message: "market holiday / no data" });
        log.info("holiday / no data", day);
        continue;
      }
      // strategies that only use today's bars (needsPrev = false) skip the previous day's download
      if (SimClass.needsPrev !== false) {
        const pday = await prevTradingDay(dh, day);
        if (!pday) {
          days.push({ ...rec, status: "skipped", message: "no previous trading day found" });
          log.warn("no previous trading day found", day);
          continue;
        }
        // today's nearest contract on the previous day: code 1, or code 2 if that day was an expiry
        const prevCode = isExpiryDay(await dh.day(pday, 1)) ? 2 : 1;
        prev = await dh.day(pday, prevCode);
      }
      if (SimClass.needsIndex) index = await dh.indexDay(day);
      // indicator strategies: the NIFTY 1-min bars of the last N trading days before this one (oldest first),
      // so an indicator can start fully warmed up at 09:15 like it is on a chart
      if (SimClass.indexHistoryDays) {
        history = [];
        let d = day;
        for (let i = 0; i < 14 && history.length < SimClass.indexHistoryDays; i++) {
          d = addDays(d, -1);
          if (isWeekend(d)) continue;
          const bars = await dh.indexDay(d);
          if (Object.keys(bars).length) history.unshift({ date: d, bars });
        }
      }
      // strategies that size their levels from the last year of NIFTY daily closes (completed days before this one)
      if (SimClass.needsDaily) {
        if (!dailyAll) dailyAll = await dh.indexDaily(addDays(input.fromDate, -640), input.toDate);
        daily = dailyAll.filter((r) => r.date < day).slice(-(SimClass.dailyCloses || 361));
      }
      if (dh.calls > calls0) log.info(`data ready (${dh.calls - calls0} API calls)`, day);
    } catch (e) {
      // token / subscription problems -> nothing else will work, stop the whole run
      if (e instanceof BacktestError && [401, 403].includes(e.status)) {
        log.error(e.message, day);
        e.details = { ...(e.details || {}), logs: log.entries };
        throw e;
      }
      log.error(`data error: ${e.message}`, day);
      errors.push({ date: day, stage: "data", message: e.message, details: e.details || null });
      days.push({ ...rec, status: "error", message: e.message });
      continue;
    }

    let sim;
    try {
      sim = new SimClass(day, today, prev, index, { history, daily, options: input.options });
      const err = sim.run();
      if (err) {
        days.push({ ...rec, status: "skipped", message: err });
        log.warn(`skipped: ${err}`, day);
        continue;
      }
    } catch (e) {
      log.error(`simulation error: ${e.message}`, day);
      errors.push({ date: day, stage: "simulation", message: e.message, stack: e.stack?.split("\n").slice(0, 4) });
      days.push({ ...rec, status: "error", message: e.message });
      continue;
    }

    const ce = legReport(sim.legs.CE);
    const pe = legReport(sim.legs.PE);
    for (const t of sim.trades) {
      const r = t.side === "CE" ? ce : pe;
      r.trades += 1;
      if (t.exitType === "TARGET") r.targets += 1;
      if (t.exitType === "SL") r.stopLosses += 1;
    }
    const dayPnl = round(sim.legs.CE.pnl + sim.legs.PE.pnl);
    cumulative += dayPnl;

    const out = {
      ...rec,
      status: "ok",
      expiryDay: isExpiryDay(today),
      ce,
      pe,
      dayPnl,
      cumulativePnl: round(cumulative),
      totalTrades: sim.trades.length,
      targets: ce.targets + pe.targets,
      stopLosses: ce.stopLosses + pe.stopLosses,
      closeReason: sim.closeReason || "-",
      trades: sim.trades,
    };
    // strategy-specific per-day fields (levels, ATM ...)
    if (sim.dayExtras) Object.assign(out, sim.dayExtras());
    // charts of the day: from the strategy, or the traded options with their entries / exits. Handed to a
    // background job's store, or sent with a single-day result; never stored in the database
    let charts = out.charts;
    delete out.charts;
    if (!charts) charts = optionTradeCharts(today, sim.trades, 1);
    if (input.collectCharts) input.collectCharts(day, charts);
    else if (input.includeEvents) out.charts = charts;
    if (input.includeEvents) out.events = sim.events;
    days.push(out);
    log.info(`CE ${ce.pnl} | PE ${pe.pnl} | day ${dayPnl} | trades ${sim.trades.length}`, day);
  }

  return { ...snapshot(), cancelled, doneDays, totalDays };
}

export const inr = (x) => `${x < 0 ? "-" : ""}₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}`;

/** Common stats + the analysis lines every strategy shares. */
export function summarize(days, lots) {
  const ok = days.filter((d) => d.status === "ok");
  if (!ok.length) return null;

  const trades = ok.flatMap((d) => d.trades);
  const ceTot = ok.reduce((s, d) => s + d.ce.pnl, 0);
  const peTot = ok.reduce((s, d) => s + d.pe.pnl, 0);
  const total = ceTot + peTot;
  const winDays = ok.filter((d) => d.dayPnl > 0);
  const lossDays = ok.filter((d) => d.dayPnl < 0);
  const wins = trades.filter((t) => t.pnl > 0).map((t) => t.pnl);
  const losses = trades.filter((t) => t.pnl <= 0).map((t) => t.pnl);
  const grossWin = wins.reduce((s, x) => s + x, 0);
  const grossLoss = -losses.reduce((s, x) => s + x, 0);

  let peak = 0;
  let maxDd = 0;
  for (const d of ok) {
    peak = Math.max(peak, d.cumulativePnl);
    maxDd = Math.min(maxDd, d.cumulativePnl - peak);
  }
  let streak = 0;
  let worstStreak = 0;
  for (const d of ok) {
    streak = d.dayPnl < 0 ? streak + 1 : 0;
    worstStreak = Math.max(worstStreak, streak);
  }
  const best = ok.reduce((a, b) => (b.dayPnl > a.dayPnl ? b : a));
  const worst = ok.reduce((a, b) => (b.dayPnl < a.dayPnl ? b : a));
  const expiryDays = ok.filter((d) => d.expiryDay);
  const exits = {};
  for (const t of trades) exits[t.exitType] = (exits[t.exitType] || 0) + 1;
  const pf = grossLoss ? grossWin / grossLoss : null;
  const byPivot = {};
  for (const t of trades) {
    const k = t.pivot.split(" ")[0];
    byPivot[k] = byPivot[k] || { trades: 0, pnl: 0 };
    byPivot[k].trades += 1;
    byPivot[k].pnl = round(byPivot[k].pnl + t.pnl);
  }

  const summary = {
    daysTraded: ok.length,
    winDays: winDays.length,
    lossDays: lossDays.length,
    flatDays: ok.length - winDays.length - lossDays.length,
    netPnl: round(total),
    cePnl: round(ceTot),
    pePnl: round(peTot),
    avgPnlPerDay: round(total / ok.length),
    bestDay: { date: best.date, pnl: best.dayPnl },
    worstDay: { date: worst.date, pnl: worst.dayPnl },
    maxDrawdown: round(maxDd),
    longestLosingStreakDays: worstStreak,
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRatePct: round((100 * wins.length) / Math.max(trades.length, 1)),
    avgWin: round(grossWin / Math.max(wins.length, 1)),
    avgLoss: round(-grossLoss / Math.max(losses.length, 1)),
    profitFactor: pf === null ? null : round(pf),
    exits,
    byPivot,
    expiryDays: expiryDays.length,
    expiryDaysPnl: round(expiryDays.reduce((s, d) => s + d.dayPnl, 0)),
  };

  const head = [];
  head.push(`Strategy ${total >= 0 ? "made" : "lost"} ${inr(Math.abs(total))} over ${ok.length} days with ${lots} lot per trade; ` +
    `${Math.round((100 * winDays.length) / ok.length)}% of days were green.`);
  if (ceTot * peTot < 0) {
    head.push(`${ceTot > peTot ? "CE" : "PE"} side carried the result (CE ${inr(ceTot)} vs PE ${inr(peTot)}).`);
  } else {
    head.push(`Both sides moved the same way (CE ${inr(ceTot)}, PE ${inr(peTot)}).`);
  }

  const tail = [];
  const pivots = Object.entries(byPivot).sort((a, b) => b[1].pnl - a[1].pnl);
  if (pivots.length > 1) {
    const [bk, bv] = pivots[0];
    const [wk, wv] = pivots[pivots.length - 1];
    tail.push(`Best pivot to trade from: ${bk} (${bv.trades} trades, ${inr(bv.pnl)}); worst: ${wk} (${wv.trades} trades, ${inr(wv.pnl)}).`);
  }
  if (expiryDays.length) tail.push(`Expiry days: ${expiryDays.length} day(s), net ${inr(summary.expiryDaysPnl)}.`);
  tail.push("P&L is gross: no brokerage, taxes or slippage. Fills come from 1-min bars " +
    "(O-L-H-C / O-H-L-C path), so treat it as an estimate, not tick-exact.");

  return { summary, trades, head, tail };
}
