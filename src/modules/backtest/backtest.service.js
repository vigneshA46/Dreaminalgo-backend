/**
 * BACKTEST — nifty_option_buying_pivot_cum_ltp (Option pivot)
 *
 * Port of Papertrade_dhan5/backtest_nifty_option_buying_pivot_cum_ltp.py
 *
 * Data: Dhan "Expired Options Data" API (/v2/charts/rollingoption), 1-minute bars,
 * ATM-10 .. ATM+10 for CE and PE, nearest weekly expiry (expiryCode 1).
 * Dhan allows only ONE day per request -> 42 calls per day (+42 for the next expiry
 * when the previous day was an expiry day). Every request downloads fresh data with
 * the caller's own clientId / accessToken — nothing is stored on disk.
 *
 * Simulation (same rules as the live strategy):
 *   - every 1-min bar becomes a tick path  O -> L -> H -> C (green) / O -> H -> L -> C (red)
 *   - inside each path leg, extra ticks are injected at every level the strategy reacts
 *     to (pivots, pivot+12, pivot-8, side target, MTM limit) so tick entries/exits fill AT the level
 *   - candle-close entries/exits fill at the NEXT bar's open (first tick of the new minute)
 *   - 09:17 selection uses the 09:16 bar close as the chain LTP
 *   - strike change uses the chain at that minute's close, new strike trades from the next minute
 *   - previous-day pivots: H / L from the contract's previous-day bars,
 *     C = volume-weighted close of 15:00-15:29 (approximation of the NSE close)
 */

import axios from "axios";

// =========================
// CONFIG (same as live)
// =========================

const TRADE_START = "09:17";
const TRADE_END = "15:14";

const TARGET_LTP = 180;
const ROLL_UPPER = 280;
const ROLL_LOWER = 170;
const PICK_MIN = 180;
const PICK_MAX = 280;
const MAX_ROLL_STEPS = 20;

const CUM_TARGET_START_POINTS = 50;
const CUM_TARGET_STEP_POINTS = 50;
const SL_BUFFER = 8;
const TICK_ENTRY_POINTS = 12;
const BASE_LOT = 2;
const MAX_LOT = 15;
const MAX_LOSS = -13000;
const LOTSIZE = 65;

const REARM_AFTER_TARGET = true;
const MAX_STRIKE_CANDIDATES = 6;

// =========================
// DATA CONFIG
// =========================

const ROLLING_URL = "https://api.dhan.co/v2/charts/rollingoption";
const NIFTY_ID = 13;
const OFFSETS = Array.from({ length: 21 }, (_, i) => i - 10);
const CALL_GAP_MS = 220;          // Dhan data API ~5 req/s
const EXPIRY_TV_MAX = 25.0;       // lowest ATM straddle time value 15:15-15:29 below this -> expiry day
const TICK_EPS = 0.05;            // NSE option tick size
const MAX_RANGE_DAYS = 92;
const IST_OFFSET_SEC = 19800;

// Dhan error codes that make every further call pointless
const FATAL_DHAN_CODES = {
  "DH-901": { status: 401, message: "Dhan rejected the access token (invalid or expired)" },
  "DH-902": { status: 403, message: "Dhan account has no Data API subscription (needed for expired options data)" },
  "DH-903": { status: 403, message: "Dhan account error — check the account segments / status" },
};

export class BacktestError extends Error {
  constructor(message, status = 500, details = null) {
    super(message);
    this.name = "BacktestError";
    this.status = status;
    this.details = details;
  }
}

// =========================
// SMALL HELPERS
// =========================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (x, d = 2) => parseFloat(Number(x).toFixed(d));

const toISODate = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return toISODate(d);
};
const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 Sun .. 6 Sat
const isWeekend = (iso) => [0, 6].includes(weekday(iso));
const dowName = (iso) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday(iso)];
const todayIST = () => toISODate(new Date(Date.now() + IST_OFFSET_SEC * 1000));

function istParts(epochSec) {
  const s = new Date((epochSec + IST_OFFSET_SEC) * 1000).toISOString();
  return { date: s.slice(0, 10), hhmm: s.slice(11, 16) };
}

function minutesBetween(start, end) {
  const out = [];
  let [h, m] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  while (h < eh || (h === eh && m <= em)) {
    out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    m += 1;
    if (m === 60) { m = 0; h += 1; }
  }
  return out;
}

class RunLog {
  constructor() {
    this.entries = [];
  }
  add(level, message, date = null) {
    const e = { time: new Date().toISOString(), level, message };
    if (date) e.date = date;
    this.entries.push(e);
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(`[backtest] ${date ? date + " " : ""}${message}`);
  }
  info(m, d) { this.add("info", m, d); }
  warn(m, d) { this.add("warn", m, d); }
  error(m, d) { this.add("error", m, d); }
}

// =========================
// DHAN DATA
// =========================

// one queue for the whole process: every backtest request shares the Dhan rate limit
let lastCallAt = 0;
let callChain = Promise.resolve();
function throttle() {
  const next = callChain.then(async () => {
    const wait = CALL_GAP_MS - (Date.now() - lastCallAt);
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
  });
  callChain = next.catch(() => {});
  return next;
}

class DhanData {
  constructor({ clientId, accessToken, log }) {
    this.headers = {
      "access-token": accessToken,
      "client-id": clientId,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    this.log = log;
    this.calls = 0;
    this.mem = new Map(); // per request only: a day is downloaded once even if used as "today" and "previous day"
  }

  async post(body) {
    for (let attempt = 0; attempt < 6; attempt++) {
      await throttle();
      this.calls += 1;
      let res;
      try {
        res = await axios.post(ROLLING_URL, body, {
          headers: this.headers,
          timeout: 30000,
          validateStatus: () => true,
        });
      } catch (e) {
        this.log.warn(`network error (${e.code || e.message}) — retry ${attempt + 1}`);
        await sleep(2000 * (attempt + 1));
        continue;
      }

      if (res.status === 200) return res.data?.data || {};

      const code = res.data?.errorCode;
      if (FATAL_DHAN_CODES[code]) {
        const f = FATAL_DHAN_CODES[code];
        throw new BacktestError(f.message, f.status, { dhanStatus: res.status, dhanError: res.data });
      }
      // Dhan also answers a revoked / replaced token with 400 DH-906 "Invalid Token"
      if (res.status === 401 || (code === "DH-906" && /token/i.test(res.data?.errorMessage || ""))) {
        throw new BacktestError(FATAL_DHAN_CODES["DH-901"].message, 401, { dhanStatus: 401, dhanError: res.data });
      }
      if (res.status === 429 || code === "DH-904") {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (attempt < 2) {
        await sleep(2000);
        continue;
      }
      const msg = res.data?.errorMessage || JSON.stringify(res.data).slice(0, 200);
      throw new BacktestError(`Dhan rollingoption ${res.status} ${code || ""}: ${msg}`.trim(), 502, {
        dhanStatus: res.status,
        dhanError: res.data,
        request: { strike: body.strike, option: body.drvOptionType, date: body.fromDate, expiryCode: body.expiryCode },
      });
    }
    throw new BacktestError("Dhan rollingoption: too many retries (rate limit / network)", 503);
  }

  async fetchSeries(day, code, offset, opt) {
    const body = {
      exchangeSegment: "NSE_FNO",
      interval: "1",
      securityId: NIFTY_ID,
      instrument: "OPTIDX",
      expiryFlag: "WEEK",
      expiryCode: code,
      strike: offset === 0 ? "ATM" : `ATM${offset > 0 ? "+" : ""}${offset}`,
      drvOptionType: opt,
      requiredData: ["open", "high", "low", "close", "volume", "strike", "spot"],
      fromDate: day,
      toDate: addDays(day, 1),
    };
    const data = await this.post(body);
    const s = data.ce || data.pe || {};
    const rows = [];
    (s.timestamp || []).forEach((ts, i) => {
      const t = istParts(ts);
      if (t.date !== day) return; // Dhan may also return the next day
      rows.push({
        hhmm: t.hhmm,
        strike: Number(s.strike[i]),
        bar: [Number(s.open[i]), Number(s.high[i]), Number(s.low[i]), Number(s.close[i]), Number(s.volume[i] || 0)],
        spot: Number(s.spot[i] || 0),
      });
    });
    return rows;
  }

  /** { holiday, spot: {hhmm: spot}, CE: Map(strike -> {hhmm: [o,h,l,c,v]}), PE: Map(...) } */
  async day(day, code = 1) {
    const key = `${day}_c${code}`;
    if (this.mem.has(key)) return this.mem.get(key);
    if (isWeekend(day)) return { holiday: true };

    let out;
    const probe = await this.fetchSeries(day, code, 0, "CALL"); // no rows -> market holiday
    if (!probe.length) {
      out = { holiday: true };
    } else {
      out = { holiday: false, spot: {}, CE: new Map(), PE: new Map() };
      for (const [opt, side] of [["CALL", "CE"], ["PUT", "PE"]]) {
        for (const off of OFFSETS) {
          const rows = side === "CE" && off === 0 ? probe : await this.fetchSeries(day, code, off, opt);
          for (const r of rows) {
            if (!out[side].has(r.strike)) out[side].set(r.strike, {});
            out[side].get(r.strike)[r.hhmm] = r.bar;
            if (r.spot) out.spot[r.hhmm] = r.spot;
          }
        }
      }
    }

    this.mem.set(key, out);
    return out;
  }
}

function isExpiryDay(dd) {
  if (!dd || dd.holiday) return false;
  // spot and option prints are not perfectly aligned near the close -> take the
  // lowest time value seen 15:15-15:29 (expiry day ~0-10, any other day 60+)
  const both = [...dd.CE.keys()].filter((k) => dd.PE.has(k)).sort((a, b) => a - b);
  if (!both.length) return false;
  const tvs = [];
  for (let m = 15; m < 30; m++) {
    const hhmm = `15:${String(m).padStart(2, "0")}`;
    const spot = dd.spot[hhmm];
    if (!spot) continue;
    const strike = both.reduce((best, k) => (Math.abs(k - spot) < Math.abs(best - spot) ? k : best), both[0]);
    const ce = dd.CE.get(strike)[hhmm];
    const pe = dd.PE.get(strike)[hhmm];
    if (ce && pe) tvs.push(ce[3] + pe[3] - Math.abs(spot - strike));
  }
  return tvs.length > 0 && Math.min(...tvs) < EXPIRY_TV_MAX;
}

function prevDayOhlc(bars) {
  if (!bars) return null;
  const keys = Object.keys(bars).sort();
  if (!keys.length) return null;
  const last30 = keys.filter((k) => k >= "15:00" && k <= "15:29").map((k) => bars[k]);
  if (!last30.length) return null;
  const vol = last30.reduce((s, b) => s + b[4], 0);
  const close = vol > 0 ? last30.reduce((s, b) => s + b[3] * b[4], 0) / vol : last30[last30.length - 1][3];
  const all = Object.values(bars);
  return {
    high: Math.max(...all.map((b) => b[1])),
    low: Math.min(...all.map((b) => b[2])),
    close: round(close, 2),
  };
}

function calculatePivots(ohlc) {
  const { high: h, low: l, close: c } = ohlc;
  const p = (h + l + c) / 3;
  const pivots = {
    S3: l - 2 * (h - p),
    S2: p - (h - l),
    S1: 2 * p - h,
    P: p,
    R1: 2 * p - l,
    R2: p + (h - l),
    R3: h + 2 * (p - l),
  };
  // option premium can't go below 0 -> drop negative levels
  const levels = Object.entries(pivots)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => [k, round(v, 2)])
    .sort((a, b) => a[1] - b[1]);
  return { pivots, levels };
}

// =========================
// ONE DAY SIMULATION
// =========================

class DaySim {
  constructor(day, todayData, prevData) {
    this.day = day;
    this.data = todayData;   // nearest expiry, today
    this.prev = prevData;    // SAME contracts, previous trading day
    this.legs = { CE: this.initLeg("CE"), PE: this.initLeg("PE") };
    this.dayClosed = false;
    this.closeReason = null;
    this.trades = [];
    this.events = [];
    this.now = null;
  }

  // ---------- leg state (mirrors live init_leg) ----------

  initLeg(name) {
    return {
      name, strike: null, pivots: {}, levels: [], ohlc: null, firstLevels: null,
      armedPivot: null, prevLtp: null, skipFirstCandle: true,
      position: false, entryPrice: null, entryTime: null, entryPivot: null, entryReason: null,
      lot: BASE_LOT, pnl: 0, targetPoints: CUM_TARGET_START_POINTS, ltp: 0,
      tradingDisabled: false, rolling: false, pending: null, lastBar: null,
      lastRollFail: null, strikesUsed: [], maxLot: BASE_LOT,
    };
  }

  log(type, msg, extra = {}) {
    this.events.push({ time: this.now, type, message: msg, ...extra });
  }

  // ---------- selection ----------

  buildSelection(side, strike, ltp) {
    const ohlc = prevDayOhlc(this.prev[side].get(strike));
    if (!ohlc) return null;
    const { pivots, levels } = calculatePivots(ohlc);
    return { strike, ltp, ohlc, pivots, levels };
  }

  chainRows(side, hhmm) {
    const rows = [];
    for (const [strike, bars] of this.data[side]) {
      const b = bars[hhmm];
      if (b && b[3] > 0) rows.push([strike, b[3]]);
    }
    return rows.sort((a, b) => a[0] - b[0]);
  }

  selectInitialStrike(side) {
    const rows = this.chainRows(side, "09:16").sort((a, b) => Math.abs(a[1] - TARGET_LTP) - Math.abs(b[1] - TARGET_LTP));
    for (const [strike, ltp] of rows.slice(0, MAX_STRIKE_CANDIDATES)) {
      const sel = this.buildSelection(side, strike, ltp);
      if (sel) return sel;
    }
    return null;
  }

  static rollTrigger(ltp) {
    if (ltp > ROLL_UPPER) return "HIGH";
    if (ltp < ROLL_LOWER) return "LOW";
    return null;
  }

  /** +1 -> higher strikes, -1 -> lower strikes */
  static rollDirection(side, trigger) {
    if (side === "CE") return trigger === "LOW" ? -1 : +1;
    return trigger === "LOW" ? +1 : -1;
  }

  selectRollStrike(side, currentStrike, trigger, hhmm) {
    const rows = this.chainRows(side, hhmm);
    const direction = DaySim.rollDirection(side, trigger);
    let idx;
    if (direction > 0) {
      idx = rows.findIndex((r) => r[0] > currentStrike);
      if (idx === -1) idx = rows.length;
    } else {
      idx = -1;
      rows.forEach((r, i) => { if (r[0] < currentStrike) idx = i; });
    }

    let steps = 0;
    while (idx >= 0 && idx < rows.length && steps < MAX_ROLL_STEPS) {
      const [strike, ltp] = rows[idx];
      steps += 1;
      if (PICK_MIN < ltp && ltp < PICK_MAX) {
        const sel = this.buildSelection(side, strike, ltp);
        if (sel) return sel;
      } else if (trigger === "LOW" && ltp >= PICK_MAX) {
        break;
      } else if (trigger === "HIGH" && ltp <= PICK_MIN) {
        break;
      }
      idx += direction;
    }
    return null;
  }

  applyContract(leg, sel) {
    leg.strike = sel.strike;
    leg.pivots = sel.pivots;
    leg.levels = sel.levels;
    leg.ohlc = sel.ohlc;
    leg.armedPivot = null;
    leg.prevLtp = null;
    leg.ltp = sel.ltp;
    leg.lastBar = null;
    leg.strikesUsed.push(sel.strike);
    if (!leg.firstLevels) leg.firstLevels = sel.levels;
    this.log("SELECT", `${leg.name} ${sel.strike} LTP ${sel.ltp}`, {
      side: leg.name, strike: sel.strike, ltp: sel.ltp, prevDay: sel.ohlc,
      pivots: Object.fromEntries(sel.levels),
    });
  }

  // ---------- pnl ----------

  static runningPnl(leg) {
    if (!leg.position) return 0;
    return (leg.ltp - leg.entryPrice) * LOTSIZE * leg.lot;
  }

  realizedTotal() {
    return this.legs.CE.pnl + this.legs.PE.pnl;
  }

  // ---------- orders ----------

  enterPosition(leg, price, pivot, reason = null) {
    leg.position = true;
    leg.entryPrice = price;
    leg.entryTime = this.now;
    leg.entryPivot = pivot;
    leg.entryReason = reason || `Candle close > ${pivot[0]} ${pivot[1]}`;
    leg.maxLot = Math.max(leg.maxLot, leg.lot);
    this.log("ENTRY", `BUY ${leg.name} ${leg.strike} @ ${price.toFixed(2)} lot ${leg.lot} | ${leg.entryReason}`, {
      side: leg.name, strike: leg.strike, price: round(price), lot: leg.lot,
    });
  }

  exitPosition(leg, price, reason, kind) {
    const tradePnl = (price - leg.entryPrice) * LOTSIZE * leg.lot;
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
      pivot: `${leg.entryPivot[0]} ${leg.entryPivot[1]}`,
      entryReason: leg.entryReason,
      exitReason: reason,
      exitType: kind,
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

    // fresh pivot touch required after exit
    if (kind === "SL" || (kind === "TARGET" && REARM_AFTER_TARGET)) leg.armedPivot = null;

    // lot progression
    if (kind === "TARGET") {
      leg.lot = BASE_LOT;
      leg.targetPoints += CUM_TARGET_STEP_POINTS;
      while (leg.targetPoints * LOTSIZE <= leg.pnl) leg.targetPoints += CUM_TARGET_STEP_POINTS;
    } else if (kind === "SL") {
      leg.lot = Math.min(leg.lot + 1, MAX_LOT);
    }
  }

  squareOffAll(reason) {
    if (this.dayClosed) return;
    for (const leg of Object.values(this.legs)) {
      if (leg.position) this.exitPosition(leg, leg.ltp, reason, "FORCE");
      leg.tradingDisabled = true;
    }
    this.dayClosed = true;
    this.closeReason = reason;
  }

  // ---------- strategy (mirrors live) ----------

  inTradeWindow() {
    return TRADE_START <= this.now && this.now < TRADE_END;
  }

  onCandleClose(leg, candle, ltp) {
    const [o, h, l, c] = candle;

    // ---- candle close SL ----
    if (leg.position) {
      const pivot = leg.entryPivot;
      if (c < pivot[1]) {
        this.exitPosition(leg, ltp, `Candle close ${c} < ${pivot[0]} ${pivot[1]}`, "SL");
        return true;
      }
      return false;
    }

    // first candle after (re)selection is partial -> ignore for entry
    if (leg.skipFirstCandle) {
      leg.skipFirstCandle = false;
      return false;
    }

    const pivot = leg.armedPivot;
    if (!pivot || !this.inTradeWindow()) return false;

    const avg = (o + h + l + c) / 4;
    const level = pivot[1];
    if (c > level && avg > level && avg < c) this.enterPosition(leg, ltp, pivot);
    return false;
  }

  checkTickExits(leg, ltp) {
    // ---- cumulative SIDE target (realized + running, across strikes) ----
    const targetRs = leg.targetPoints * LOTSIZE;
    const sideTotal = leg.pnl + DaySim.runningPnl(leg);
    if (sideTotal >= targetRs - 1e-6) {
      this.exitPosition(leg, ltp, `Side target ₹${targetRs.toFixed(0)} (side pnl ${sideTotal.toFixed(0)})`, "TARGET");
      return true;
    }
    const pivot = leg.entryPivot;
    if (ltp <= pivot[1] - SL_BUFFER + 1e-9) {
      this.exitPosition(leg, ltp, `Tick ${ltp.toFixed(2)} <= ${pivot[0]} ${pivot[1]} - ${SL_BUFFER}`, "SL");
      return true;
    }
    return false;
  }

  checkTickEntry(leg, ltp) {
    const pivot = leg.armedPivot;
    if (!pivot || !this.inTradeWindow()) return false;
    if (ltp >= pivot[1] + TICK_ENTRY_POINTS - 1e-9) {
      this.enterPosition(leg, ltp, pivot, `Tick >= ${pivot[0]} ${pivot[1]} + ${TICK_ENTRY_POINTS}`);
      return true;
    }
    return false;
  }

  updateTouch(leg, ltp) {
    const prev = leg.prevLtp;
    if (prev === null) return;
    const lo = Math.min(prev, ltp);
    const hi = Math.max(prev, ltp);
    const crossed = leg.levels.filter((lv) => lo <= lv[1] && lv[1] <= hi);
    if (!crossed.length) return;
    const level = crossed.reduce((best, lv) => (Math.abs(lv[1] - ltp) < Math.abs(best[1] - ltp) ? lv : best), crossed[0]);
    if (!leg.armedPivot || leg.armedPivot[0] !== level[0] || leg.armedPivot[1] !== level[1]) {
      leg.armedPivot = level;
    }
  }

  checkMtm() {
    const total = this.realizedTotal() + DaySim.runningPnl(this.legs.CE) + DaySim.runningPnl(this.legs.PE);
    if (total <= MAX_LOSS + 1e-6 && !this.dayClosed) {
      this.log("MTM", `MTM LIMIT HIT (${total.toFixed(0)})`);
      this.squareOffAll("MTM -13000");
    }
  }

  /** One tick of one leg — same order as live on_message. */
  onTick(leg, ltp, candle = null) {
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

    // ---- CANDLE LOGIC (entry / candle close SL) ----
    if (candle) exited = this.onCandleClose(leg, candle, ltp);

    // ---- TICK EXITS (target / pivot-8 SL) ----
    if (leg.position) exited = this.checkTickExits(leg, ltp) || exited;

    // ---- PIVOT TOUCH (only when flat, not on the exit tick) ----
    if (!leg.position && !exited) this.updateTouch(leg, ltp);

    // ---- TICK BREAKOUT ENTRY (armed pivot + 12) ----
    if (!leg.position && !exited) this.checkTickEntry(leg, ltp);

    leg.prevLtp = ltp;

    // ---- STRIKE CHANGE (only when flat: > 280 or < 170) ----
    if (!leg.position && this.inTradeWindow()) {
      const trigger = DaySim.rollTrigger(ltp);
      if (trigger) this.startRoll(leg, trigger);
    }

    this.checkMtm();
  }

  // ---------- strike change ----------

  startRoll(leg, trigger) {
    if (leg.rolling || leg.lastRollFail === this.now) return;
    const sel = this.selectRollStrike(leg.name, leg.strike, trigger, this.now);
    if (!sel) {
      leg.lastRollFail = this.now; // live retries after 15s -> next minute
      this.log("ROLL_FAIL", `${leg.name} ${leg.strike} LTP ${leg.ltp.toFixed(2)} roll ${trigger}: no strike in range`, { side: leg.name });
      return;
    }
    leg.rolling = true;
    leg.pending = sel;
    this.log("ROLL", `${leg.name} ${leg.strike} LTP ${leg.ltp.toFixed(2)} -> ${sel.strike} (LTP ${sel.ltp})`, {
      side: leg.name, from: leg.strike, to: sel.strike, trigger,
    });
  }

  finishRoll(leg) {
    const sel = leg.pending;
    leg.pending = null;
    leg.rolling = false;
    if (leg.position || leg.tradingDisabled || this.dayClosed) return;
    this.applyContract(leg, sel);
    // first candle of the new contract is complete in 1-min data -> no skip
    leg.skipFirstCandle = false;
  }

  // ---------- tick path ----------

  levelCandidates(leg) {
    const lv = leg.levels.map((x) => x[1]);
    if (leg.position) {
      lv.push(leg.entryPivot[1] - SL_BUFFER);
      const remaining = leg.targetPoints * LOTSIZE - leg.pnl;
      lv.push(leg.entryPrice + remaining / (LOTSIZE * leg.lot));
      const other = this.legs[leg.name === "CE" ? "PE" : "CE"];
      const room = MAX_LOSS - this.realizedTotal() - DaySim.runningPnl(other);
      lv.push(leg.entryPrice + room / (LOTSIZE * leg.lot));
    } else {
      if (leg.armedPivot) lv.push(leg.armedPivot[1] + TICK_ENTRY_POINTS);
      lv.push(ROLL_UPPER + TICK_EPS);
      lv.push(ROLL_LOWER - TICK_EPS);
    }
    return lv;
  }

  /** Continuous move a -> b: ticks at every level the strategy cares about, then b. */
  walk(leg, a, b) {
    let cur = a;
    for (;;) {
      if (leg.tradingDisabled || leg.rolling || this.dayClosed) return;
      let step;
      if (b > cur) {
        const nxt = this.levelCandidates(leg).filter((x) => cur < x && x < b);
        step = nxt.length ? Math.min(...nxt) : b;
      } else if (b < cur) {
        const nxt = this.levelCandidates(leg).filter((x) => b < x && x < cur);
        step = nxt.length ? Math.max(...nxt) : b;
      } else {
        return;
      }
      this.onTick(leg, round(step, 4));
      cur = step;
      if (step === b) return;
    }
  }

  runBar(leg, bar) {
    const [o, h, l, c] = bar;
    const candle = leg.lastBar;
    leg.lastBar = bar;
    // first tick of the minute closes the previous candle
    this.onTick(leg, o, candle);
    const p = c >= o ? [o, l, h, c] : [o, h, l, c];
    for (let i = 0; i < p.length - 1; i++) this.walk(leg, p[i], p[i + 1]);
  }

  // ---------- day ----------

  run() {
    this.now = TRADE_START;
    for (const side of ["CE", "PE"]) {
      const sel = this.selectInitialStrike(side);
      if (!sel) return `no ${side} strike near ${TARGET_LTP} with previous-day data`;
      this.applyContract(this.legs[side], sel);
    }

    for (const hhmm of minutesBetween(TRADE_START, "15:29")) {
      this.now = hhmm;
      for (const side of ["CE", "PE"]) {
        const leg = this.legs[side];
        if (leg.pending) this.finishRoll(leg);
        const bar = this.data[side].get(leg.strike)?.[hhmm];
        if (bar) this.runBar(leg, bar);
        else if (hhmm >= TRADE_END) this.onTick(leg, leg.ltp);
      }
      if (this.dayClosed) break;
    }

    if (!this.dayClosed) this.squareOffAll("TIME EXIT 15:14");
    return null;
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
    maxLot: leg.maxLot,
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
  const mtmDays = ok.filter((d) => d.closeReason.startsWith("MTM"));
  const expiryDays = ok.filter((d) => d.expiryDay);
  const exits = {};
  for (const t of trades) exits[t.exitType] = (exits[t.exitType] || 0) + 1;
  const maxLot = Math.max(0, ...trades.map((t) => t.lot));
  const pf = grossLoss ? grossWin / grossLoss : null;

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
    maxLotUsed: maxLot,
    mtmStopDays: mtmDays.length,
    expiryDays: expiryDays.length,
    expiryDaysPnl: round(expiryDays.reduce((s, d) => s + d.dayPnl, 0)),
  };

  const inr = (x) => `${x < 0 ? "-" : ""}₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}`;
  const analysis = [];
  analysis.push(`Strategy ${total >= 0 ? "made" : "lost"} ${inr(Math.abs(total))} over ${ok.length} days; ` +
    `${Math.round((100 * winDays.length) / ok.length)}% of days were green.`);
  if (ceTot * peTot < 0) {
    analysis.push(`${ceTot > peTot ? "CE" : "PE"} side carried the result (CE ${inr(ceTot)} vs PE ${inr(peTot)}).`);
  } else {
    analysis.push(`Both sides contributed in the same direction (CE ${inr(ceTot)}, PE ${inr(peTot)}).`);
  }
  if (wins.length && losses.length) {
    const ratio = (grossWin / wins.length) / (grossLoss / losses.length);
    analysis.push(`Trade win rate is ${Math.round((100 * wins.length) / trades.length)}% with avg win / avg loss ${ratio.toFixed(2)} — ` +
      `the lot ladder (+1 lot per SL, up to ${MAX_LOT}) is what turns the fewer target hits into profit.`);
  }
  if (mtmDays.length) {
    analysis.push(`The −₹13,000 MTM stop fired on ${mtmDays.length} day(s), ${inr(mtmDays.reduce((s, d) => s + d.dayPnl, 0))} in total — ` +
      `days where the lot ladder ran up without a target hit.`);
  }
  if (maxLot >= 8) analysis.push(`Lots climbed to ${maxLot} at least once — watch margin and slippage at that size.`);
  if (expiryDays.length) analysis.push(`Expiry days: ${expiryDays.length} day(s), net ${inr(summary.expiryDaysPnl)}.`);
  analysis.push("P&L is gross: no brokerage, taxes or slippage. Fills come from 1-min bars " +
    "(O-L-H-C / O-H-L-C path), so treat it as an estimate, not tick-exact.");

  return { summary, analysis };
}

// =========================
// VALIDATION
// =========================

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && toISODate(d) === s;
}

export function validateBacktestInput(body) {
  const errors = [];
  const { clientId, accessToken, fromDate, toDate } = body || {};

  if (!clientId || typeof clientId !== "string" && typeof clientId !== "number") errors.push("clientId is required");
  if (!accessToken || typeof accessToken !== "string") errors.push("accessToken is required");
  if (!validDate(fromDate)) errors.push("fromDate is required as YYYY-MM-DD");
  if (!validDate(toDate)) errors.push("toDate is required as YYYY-MM-DD");

  if (!errors.length) {
    const today = todayIST();
    const fiveYearsAgo = addDays(today, -5 * 365);
    if (toDate < fromDate) errors.push("toDate is before fromDate");
    if (toDate >= today) errors.push(`toDate must be before today (${today}) — only completed days can be backtested`);
    if (fromDate < fiveYearsAgo) errors.push(`fromDate is older than Dhan's 5-year expired options history (${fiveYearsAgo})`);
    const span = (new Date(`${toDate}T00:00:00Z`) - new Date(`${fromDate}T00:00:00Z`)) / 86400000 + 1;
    if (span > MAX_RANGE_DAYS) errors.push(`date range is ${span} days — max ${MAX_RANGE_DAYS} per request`);
  }

  if (errors.length) throw new BacktestError("Invalid input", 400, errors);
  return {
    clientId: String(clientId).trim(),
    accessToken: accessToken.trim(),
    fromDate,
    toDate,
    includeEvents: body.includeEvents === true,
  };
}

// =========================
// RUNNER
// =========================

async function prevTradingDay(dh, day) {
  let d = addDays(day, -1);
  for (let i = 0; i < 12; i++) {
    if (!isWeekend(d)) {
      const dd = await dh.day(d, 1);
      if (!dd.holiday) return d;
    }
    d = addDays(d, -1);
  }
  return null;
}

export async function runPivotOptionBuyingCumBacktest(input) {
  const started = Date.now();
  const log = new RunLog();
  const dh = new DhanData({ clientId: input.clientId, accessToken: input.accessToken, log });

  log.info(`backtest ${input.fromDate} -> ${input.toDate}`);

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
      sim = new DaySim(day, today, prev);
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
    log.info(`CE ${ce.pnl} | PE ${pe.pnl} | day ${dayPnl} | trades ${sim.trades.length} | ${out.closeReason}`, day);
  }

  const { summary, analysis } = buildSummary(days);
  const tradingDays = days.filter((d) => d.status !== "holiday");
  const allFailed = tradingDays.length > 0 && tradingDays.every((d) => d.status === "error");

  return {
    success: !allFailed,
    strategy: "nifty_option_buying_pivot_cum_ltp",
    params: {
      fromDate: input.fromDate,
      toDate: input.toDate,
      lotSize: LOTSIZE,
      baseLot: BASE_LOT,
      maxLot: MAX_LOT,
      targetLtp: TARGET_LTP,
      rollRange: [ROLL_LOWER, ROLL_UPPER],
      pickRange: [PICK_MIN, PICK_MAX],
      sideTargetStep: CUM_TARGET_STEP_POINTS * LOTSIZE,
      slBuffer: SL_BUFFER,
      tickEntryPoints: TICK_ENTRY_POINTS,
      maxLoss: MAX_LOSS,
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

// shared with the other pivot backtests (pivotBuffer.service.js)
export {
  round,
  addDays,
  isWeekend,
  dowName,
  minutesBetween,
  RunLog,
  DhanData,
  DaySim,
  isExpiryDay,
  prevDayOhlc,
  calculatePivots,
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
};
