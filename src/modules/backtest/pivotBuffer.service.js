/**
 * BACKTEST — nifty_option_pivot_buffer (Option pivot buffer)
 *
 * NIFTY CE + PE option buying, two independent legs, everything tick based.
 *   - 09:17: CE and PE strikes priced nearest ₹180, pivots (S3..R3) from each
 *     option's own previous-day H / L / C            (same as pivot_cum)
 *   - a tick touching a pivot ARMS it; gap = next pivot above - armed pivot
 *       buffer = pivot + 25% of gap   -> any tick >= buffer: BUY 1 lot
 *       target = entry + 30% of gap   -> any tick >= target: exit (TARGET)
 *       SL     = tick back at the armed pivot          -> exit (SL)
 *   - after an SL the pivot stays armed (re-entry when the buffer is hit again);
 *     after a TARGET a fresh pivot touch is needed
 *   - top pivot (no pivot above it) never gives an entry
 *   - strike change when flat and LTP > 280 / < 170   (same as pivot_cum)
 *   - no daily profit / loss limit, everything closed at 15:14
 *
 * Data, tick path, strike selection and strike change are shared with
 * backtest.service.js (Dhan expired options 1-min data, O-L-H-C / O-H-L-C path).
 */

import {
  BacktestError,
  round,
  addDays,
  isWeekend,
  dowName,
  RunLog,
  DhanData,
  DaySim,
  isExpiryDay,
  prevTradingDay,
  LOTSIZE,
  TRADE_START,
  TRADE_END,
  TARGET_LTP,
  ROLL_LOWER,
  ROLL_UPPER,
  PICK_MIN,
  PICK_MAX,
  TICK_EPS,
} from "./backtest.service.js";

// =========================
// CONFIG
// =========================

const BUFFER_PCT = 0.25;   // entry buffer above the armed pivot (share of the pivot gap)
const TARGET_PCT = 0.30;   // target above the entry price (share of the pivot gap)
const LOTS = 1;

// =========================
// ONE DAY SIMULATION
// =========================

class PivotBufferDaySim extends DaySim {
  initLeg(name) {
    return {
      ...super.initLeg(name),
      lot: LOTS,
      maxLot: LOTS,
      armed: null,          // { name, value, next, nextValue, gap, buffer } of the last touched pivot
      entryArm: null,       // armed pivot the open trade was taken from
      target: null,
    };
  }

  applyContract(leg, sel) {
    super.applyContract(leg, sel);
    leg.armed = null;
  }

  // ---------- pivots ----------

  arm(leg, level) {
    const idx = leg.levels.findIndex((lv) => lv[0] === level[0] && lv[1] === level[1]);
    const next = leg.levels[idx + 1] || null;
    if (leg.armed && leg.armed.name === level[0] && leg.armed.value === level[1]) return;
    const gap = next ? next[1] - level[1] : null;
    leg.armed = {
      name: level[0],
      value: level[1],
      next: next ? next[0] : null,
      nextValue: next ? next[1] : null,
      gap: gap === null ? null : round(gap, 2),
      buffer: gap === null ? null : round(level[1] + BUFFER_PCT * gap, 2),
    };
    this.log(
      "ARM",
      next
        ? `${leg.name} touched ${level[0]} ${level[1]} -> buffer ${leg.armed.buffer} (gap to ${next[0]} ${next[1]} = ${leg.armed.gap})`
        : `${leg.name} touched ${level[0]} ${level[1]} (top pivot, no entry)`,
      { side: leg.name, pivot: level[0], value: level[1], buffer: leg.armed.buffer }
    );
  }

  updateTouch(leg, ltp) {
    const prev = leg.prevLtp;
    if (prev === null) return;
    const lo = Math.min(prev, ltp);
    const hi = Math.max(prev, ltp);
    const crossed = leg.levels.filter((lv) => lo <= lv[1] && lv[1] <= hi);
    if (!crossed.length) return;
    const level = crossed.reduce((best, lv) => (Math.abs(lv[1] - ltp) < Math.abs(best[1] - ltp) ? lv : best), crossed[0]);
    this.arm(leg, level);
  }

  // ---------- orders ----------

  enterPosition(leg, price) {
    const a = leg.armed;
    leg.position = true;
    leg.entryPrice = price;
    leg.entryTime = this.now;
    leg.entryArm = a;
    leg.entryPivot = [a.name, a.value];
    leg.target = round(price + TARGET_PCT * a.gap, 2);
    leg.entryReason = `Tick >= buffer ${a.buffer} (${a.name} ${a.value} + 25% of ${a.gap})`;
    this.log("ENTRY", `BUY ${leg.name} ${leg.strike} @ ${price.toFixed(2)} lot ${leg.lot} | target ${leg.target} | SL ${a.value}`, {
      side: leg.name, strike: leg.strike, price: round(price), lot: leg.lot, target: leg.target, sl: a.value,
    });
  }

  exitPosition(leg, price, reason, kind) {
    const tradePnl = (price - leg.entryPrice) * LOTSIZE * leg.lot;
    const a = leg.entryArm;
    leg.pnl += tradePnl;
    this.trades.push({
      side: leg.name,
      strike: leg.strike,
      lot: leg.lot,
      quantity: leg.lot * LOTSIZE,
      entryTime: leg.entryTime,
      entryPrice: round(leg.entryPrice),
      exitTime: this.now,
      exitPrice: round(price),
      pivot: `${a.name} ${a.value}`,
      nextPivot: `${a.next} ${a.nextValue}`,
      gap: a.gap,
      buffer: a.buffer,
      target: leg.target,
      stopLoss: a.value,
      entryReason: leg.entryReason,
      exitReason: reason,
      exitType: kind,
      points: round(price - leg.entryPrice),
      pnl: round(tradePnl),
      sidePnlAfter: round(leg.pnl),
    });
    this.log("EXIT", `EXIT ${leg.name} ${leg.strike} @ ${price.toFixed(2)} | ${reason} | ${tradePnl.toFixed(0)}`, {
      side: leg.name, strike: leg.strike, price: round(price), pnl: round(tradePnl), exitType: kind,
    });

    leg.position = false;
    leg.entryPrice = null;
    leg.entryTime = null;
    leg.entryPivot = null;
    leg.entryArm = null;
    leg.target = null;

    // TARGET -> fresh pivot touch needed; SL -> pivot stays armed, re-entry on the buffer again
    if (kind === "TARGET") leg.armed = null;
  }

  // ---------- strategy (all tick based) ----------

  checkTickExits(leg, ltp) {
    if (ltp >= leg.target - 1e-9) {
      this.exitPosition(leg, ltp, `Tick ${ltp.toFixed(2)} >= target ${leg.target} (entry + 30% of ${leg.entryArm.gap})`, "TARGET");
      return true;
    }
    const pivot = leg.entryArm;
    if (ltp <= pivot.value + 1e-9) {
      this.exitPosition(leg, ltp, `Tick ${ltp.toFixed(2)} back at ${pivot.name} ${pivot.value}`, "SL");
      return true;
    }
    return false;
  }

  checkTickEntry(leg, ltp) {
    const a = leg.armed;
    if (!a || a.buffer === null || !this.inTradeWindow()) return false;
    if (ltp >= a.buffer - 1e-9) {
      this.enterPosition(leg, ltp);
      return true;
    }
    return false;
  }

  onTick(leg, ltp) {
    leg.ltp = ltp;

    // ---- TIME EXIT ----
    if (this.now >= TRADE_END) {
      this.squareOffAll("TIME EXIT 15:14");
      return;
    }

    if (leg.tradingDisabled || leg.rolling) {
      leg.prevLtp = ltp;
      return;
    }

    let exited = false;

    // ---- TARGET / PIVOT SL ----
    if (leg.position) exited = this.checkTickExits(leg, ltp);

    // ---- PIVOT TOUCH (flat, not on the exit tick) ----
    if (!leg.position && !exited) this.updateTouch(leg, ltp);

    // ---- BUFFER ENTRY ----
    if (!leg.position && !exited) this.checkTickEntry(leg, ltp);

    leg.prevLtp = ltp;

    // ---- STRIKE CHANGE (only when flat: > 280 or < 170) ----
    if (!leg.position && this.inTradeWindow()) {
      const trigger = DaySim.rollTrigger(ltp);
      if (trigger) this.startRoll(leg, trigger);
    }
  }

  levelCandidates(leg) {
    const lv = leg.levels.map((x) => x[1]);
    if (leg.position) {
      lv.push(leg.target, leg.entryArm.value);
    } else {
      if (leg.armed?.buffer) lv.push(leg.armed.buffer);
      lv.push(ROLL_UPPER + TICK_EPS);
      lv.push(ROLL_LOWER - TICK_EPS);
    }
    return lv;
  }

  runBar(leg, bar) {
    const [o, h, l, c] = bar;
    this.onTick(leg, o);
    const p = c >= o ? [o, l, h, c] : [o, h, l, c];
    for (let i = 0; i < p.length - 1; i++) this.walk(leg, p[i], p[i + 1]);
  }
}

// =========================
// REPORT
// =========================

function legReport(leg) {
  return {
    pnl: round(leg.pnl),
    strikes: leg.strikesUsed,
    strikeChanges: Math.max(leg.strikesUsed.length - 1, 0),
    firstPivots: leg.firstLevels ? Object.fromEntries(leg.firstLevels) : null,
    trades: 0,
    targets: 0,
    stopLosses: 0,
  };
}

function buildSummary(days) {
  const ok = days.filter((d) => d.status === "ok");
  if (!ok.length) return { summary: null, analysis: ["No traded days in this range."] };

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

  const inr = (x) => `${x < 0 ? "-" : ""}₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}`;
  const analysis = [];
  analysis.push(`Strategy ${total >= 0 ? "made" : "lost"} ${inr(Math.abs(total))} over ${ok.length} days with ${LOTS} lot per trade; ` +
    `${Math.round((100 * winDays.length) / ok.length)}% of days were green.`);
  if (ceTot * peTot < 0) {
    analysis.push(`${ceTot > peTot ? "CE" : "PE"} side carried the result (CE ${inr(ceTot)} vs PE ${inr(peTot)}).`);
  } else {
    analysis.push(`Both sides moved the same way (CE ${inr(ceTot)}, PE ${inr(peTot)}).`);
  }
  if (trades.length) {
    analysis.push(`${trades.length} trades, ${summary.winRatePct}% hit the target. Target is 30% of the pivot gap above entry ` +
      `while the SL sits 25% of the gap below entry, so wins are slightly bigger than losses before any slippage ` +
      `(avg win ${inr(summary.avgWin)} vs avg loss ${inr(summary.avgLoss)}).`);
  }
  const pivots = Object.entries(byPivot).sort((a, b) => b[1].pnl - a[1].pnl);
  if (pivots.length > 1) {
    const [bk, bv] = pivots[0];
    const [wk, wv] = pivots[pivots.length - 1];
    analysis.push(`Best pivot to trade from: ${bk} (${bv.trades} trades, ${inr(bv.pnl)}); worst: ${wk} (${wv.trades} trades, ${inr(wv.pnl)}).`);
  }
  if (expiryDays.length) analysis.push(`Expiry days: ${expiryDays.length} day(s), net ${inr(summary.expiryDaysPnl)}.`);
  analysis.push("P&L is gross: no brokerage, taxes or slippage. Fills come from 1-min bars " +
    "(O-L-H-C / O-H-L-C path), so treat it as an estimate, not tick-exact.");

  return { summary, analysis };
}

// =========================
// RUNNER
// =========================

export async function runNiftyOptionPivotBufferBacktest(input) {
  const started = Date.now();
  const log = new RunLog();
  const dh = new DhanData({ clientId: input.clientId, accessToken: input.accessToken, log });

  log.info(`pivot buffer backtest ${input.fromDate} -> ${input.toDate}`);

  const days = [];
  const errors = [];
  let cumulative = 0;

  for (let day = input.fromDate; day <= input.toDate; day = addDays(day, 1)) {
    if (isWeekend(day)) continue;
    const rec = { date: day, day: dowName(day) };

    let today;
    let prev;
    try {
      const calls0 = dh.calls;
      today = await dh.day(day, 1);
      if (today.holiday) {
        days.push({ ...rec, status: "holiday", message: "market holiday / no data" });
        log.info("holiday / no data", day);
        continue;
      }
      const pday = await prevTradingDay(dh, day);
      if (!pday) {
        days.push({ ...rec, status: "skipped", message: "no previous trading day found" });
        log.warn("no previous trading day found", day);
        continue;
      }
      // today's nearest contract on the previous day: code 1, or code 2 if that day was an expiry
      const prevCode = isExpiryDay(await dh.day(pday, 1)) ? 2 : 1;
      prev = await dh.day(pday, prevCode);
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
      sim = new PivotBufferDaySim(day, today, prev);
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
    if (input.includeEvents) out.events = sim.events;
    days.push(out);
    log.info(`CE ${ce.pnl} | PE ${pe.pnl} | day ${dayPnl} | trades ${sim.trades.length}`, day);
  }

  const { summary, analysis } = buildSummary(days);
  const tradingDays = days.filter((d) => d.status !== "holiday");
  const allFailed = tradingDays.length > 0 && tradingDays.every((d) => d.status === "error");

  return {
    success: !allFailed,
    strategy: "nifty_option_pivot_buffer",
    params: {
      fromDate: input.fromDate,
      toDate: input.toDate,
      lotSize: LOTSIZE,
      lots: LOTS,
      targetLtp: TARGET_LTP,
      rollRange: [ROLL_LOWER, ROLL_UPPER],
      pickRange: [PICK_MIN, PICK_MAX],
      bufferPctOfGap: BUFFER_PCT * 100,
      targetPctOfGap: TARGET_PCT * 100,
      stopLoss: "tick back at the armed pivot",
      tradeWindow: [TRADE_START, TRADE_END],
    },
    summary,
    analysis,
    days,
    errors,
    logs: log.entries,
    meta: {
      apiCalls: dh.calls,
      durationSec: round((Date.now() - started) / 1000, 1),
      dataSource: "Dhan /v2/charts/rollingoption (expired options, 1-min, ATM±10)",
    },
  };
}
