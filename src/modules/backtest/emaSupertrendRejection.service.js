/**
 * BACKTEST — nifty_ema_supertrend_rejection_option_buying
 *
 * Strategy 3: same indicators, filters and settings as Strategy 2 (EMA 5 / EMA 10 crossover, a candle close
 * beyond EMA 10 with the Supertrend (10, 1.5) on the trade's side), but the entry is a Supertrend LINE
 * retest with a rejection instead of an EMA 5 retest:
 *   - after the confirming candle, a LATER candle must touch the Supertrend line and close back on the
 *     trade's side of it: BUY: low <= line and close > line (green line below price),
 *     SELL: high >= line and close < line (red line above price). The candle's colour does not matter.
 *   - entry at the open of the next candle (the first option tick after the rejection candle closes)
 *   - if the Supertrend turns against an unfinished setup, it goes back to waiting for a confirming close
 *   - stop loss = target = the Supertrend turning against the trade; the reversal candle's CLOSE is the
 *     exit price (the option's price at the end of that candle)
 *   - optional day MTM target / day MTM SL, strike ATM / ITM1..ITM4, 1 lot, square off 15:14
 */

import { EmaStDaySim, runEmaStFamily, validateEmaStOptions } from "./emaSupertrend.service.js";

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

class EmaStRejectionDaySim extends EmaStDaySim {
  retestHit(buy, c, _ema5, i) {
    const line = this.stVal[i];
    if (line === null || line === undefined) return false;
    return buy ? c.low <= line && c.close > line : c.high >= line && c.close < line;
  }

  get retestLabel() {
    return "rejection";
  }

  /** exit at the close of the reversal candle: the option's close in the candle's last minute */
  turnExitPrice(side, strike) {
    const last = this.optionBar(side, strike, toHHMM(toMin(this.now) - 1));
    if (last) return last[3];
    const next = this.optionBar(side, strike, this.now);
    return next ? next[0] : this.ltp;
  }
}

export { validateEmaStOptions as validateEmaStRejectionOptions };

export const runNiftyEmaSupertrendRejectionBacktest = (input) =>
  runEmaStFamily(input, {
    strategy: "nifty_ema_supertrend_rejection_option_buying",
    Sim: EmaStRejectionDaySim,
    label: "ema supertrend rejection",
    entry: () =>
      "EMA5 crossover -> a later candle closes beyond EMA10 with the Supertrend on its side -> a later candle touches the Supertrend line and closes on the trade's side of it (rejection) -> entry at the next candle open",
    exit: "Supertrend (10, 1.5) turning against the trade, exit at the close of the reversal candle (stop loss and target are the same)",
  });

