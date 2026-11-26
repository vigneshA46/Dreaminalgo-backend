/**
 * Every strategy that has a backtest engine.
 * key = the admin API route name (/api/backtest/<key>) and the id used for user access.
 * title / description seed the backtest_strategies table; admins can edit them there.
 */

import { runPivotOptionBuyingCumBacktest } from "./backtest.service.js";
import { runNiftyOptionPivotBufferBacktest } from "./pivotBuffer.service.js";
import { runNiftyOptionPivotFixedTargetBacktest } from "./pivotFixedTarget.service.js";
import { runNiftyOptionLevelBreakoutBacktest } from "./levelBreakout.service.js";
import { runNiftyBearishBreakoutOptionBuyingBacktest } from "./bearishBreakout.service.js";
import { runNiftyHullMaOptionBuyingBacktest } from "./hullMa.service.js";
import { runNiftyEmaCrossoverRetestBacktest } from "./emaRetest.service.js";
import { runNiftyEmaSupertrendBacktest } from "./emaSupertrend.service.js";
import { runNiftyEmaSupertrendRejectionBacktest } from "./emaSupertrendRejection.service.js";
import { runNiftySupertrendEmaBuying1minBacktest } from "./supertrendEma1min.service.js";
import {
  runNiftyHourlyRangeTouchBacktest,
  runNiftyHourlyRangeTouch1mBacktest,
  runNiftyHourlyRangeTouchCustomBacktest,
} from "./hourlyRange.service.js";

export const BACKTEST_STRATEGIES = {
  pivot_option_buying_cum: {
    title: "pivot_cumulative_option_buying",
    description:
      "NIFTY CE + PE option buying on previous-day pivot levels (P, R1–R3, S1–S3). Cumulative ₹3,250 side target, " +
      "lots 2 → 15 (+1 lot on every 2nd SL in a row), strike change outside 170–280, −₹13,000 day stop.",
    run: runPivotOptionBuyingCumBacktest,
  },
  nifty_option_pivot_buffer: {
    title: "nifty_option_pivot_buffer",
    description:
      "NIFTY CE + PE option buying, all tick based. Pivot touch arms it, entry at pivot + 25% of the gap to the next pivot, " +
      "target entry + 30% of the gap, SL back at the pivot. 1 lot.",
    run: runNiftyOptionPivotBufferBacktest,
  },
  nifty_option_pivot_fixed_target: {
    title: "nifty_option_pivot_fixed_target",
    description:
      "NIFTY CE + PE option buying. Pivot touch arms it, entry on a candle close above the pivot or a tick at pivot + 8. " +
      "Fixed +10 point target, SL candle close below the pivot. 1 lot.",
    run: runNiftyOptionPivotFixedTargetBacktest,
  },
  nifty_option_level_breakout: {
    title: "nifty_option_level_breakout",
    description:
      "NIFTY ATM CE + PE. range = prev-day (H − L) × 26.11%, buy above = open + range, targets up to T11. " +
      "5-min close above buy above → 1 lot. The only exit is the Supertrend (10, 3) of the option's 5-min chart turning sell (square off 15:14).",
    run: runNiftyOptionLevelBreakoutBacktest,
  },
  nifty_hourly_range_touch: {
    title: "nifty_hourly_range_touch",
    description:
      "NIFTY hourly High / Low of the first 5 hours, each traded in the next hour. Line touch + 3-min NIFTY close beyond it " +
      "with avg-price confirmation → ATM CE / PE, 1 lot. SL 3-min close back through the line, cycle limits −₹3,500 / +₹5,000, max 2 entries per cycle.",
    run: runNiftyHourlyRangeTouchBacktest,
  },
  nifty_hourly_range_touch_1m: {
    title: "nifty_hourly_range_touch_1m",
    description:
      "Same as nifty_hourly_range_touch with 1-min NIFTY candles: line touch + 1-min close beyond it with avg-price confirmation → " +
      "ATM CE / PE, 1 lot. SL 1-min close back through the line, cycle limits −₹3,500 / +₹5,000, max 2 entries per cycle.",
    run: runNiftyHourlyRangeTouch1mBacktest,
  },
  nifty_hourly_range_touch_custom: {
    title: "nifty_hourly_range_touch_custom",
    description:
      "NIFTY hourly High / Low touch strategy with your settings: 1 / 3 / 5-min candles, strike (default ITM2), day / cycle SL and profit, per-trade profit. " +
      "Exits on a candle close back through the entry line or when NIFTY touches the cycle's other line. A touch stays valid until an entry uses it; after a stop loss the same line stays armed, after a target a fresh touch is needed. No entry limit.",
    run: runNiftyHourlyRangeTouchCustomBacktest,
  },
  nifty_bearish_breakout_option_buying: {
    title: "nifty_bearish_breakout_option_buying",
    description:
      "NIFTY CE + PE, each side one strike priced at or just above 200 at 09:30. Latest bearish 15-min candle marks its high; a tick above high + 4 buys 1 lot, " +
      "SL = low of that 15-min candle, then trail on the low − 2 of each completed 5-min Heikin Ashi candle. A fresh bearish candle is needed after every exit. Square off 15:14.",
    run: runNiftyBearishBreakoutOptionBuyingBacktest,
  },
  nifty_hull_ma_option_buying: {
    title: "nifty_hull_ma_option_buying",
    description:
      "NIFTY Hull MA (24) on 1 / 3 / 5 / 15-min candles. From 09:30 every colour change is a signal: green buys CE, red buys PE (ATM or ITM1–ITM5), the other side is closed. " +
      "1 lot, optional day MTM target and day MTM SL, square off 15:14.",
    run: runNiftyHullMaOptionBuyingBacktest,
  },
  nifty_ema_crossover_retest_option_buying: {
    title: "nifty_ema_crossover_retest_option_buying",
    description:
      "NIFTY EMA 5 / EMA 10 crossover with retest on 1 / 3 / 5 / 15-min candles. Crossover → a candle closes beyond EMA 10 → a candle retests EMA 5 → buy CE (bullish) or PE (bearish), ATM or ITM1–ITM4. " +
      "Exit on the reverse crossover. 1 lot, optional day MTM target and day MTM SL, square off 15:14.",
    run: runNiftyEmaCrossoverRetestBacktest,
  },
  nifty_ema_supertrend_option_buying: {
    title: "nifty_ema_supertrend_option_buying",
    description:
      "NIFTY EMA 5 / EMA 10 crossover with retest, filtered by Supertrend (10, 1.5), on 1 / 3 / 5 / 15-min candles. A candle must close beyond EMA 10 and the retest of EMA 5 must happen with the Supertrend on the trade's side → buy CE (bullish) or PE (bearish), ATM or ITM1–ITM4. " +
      "Exit when the Supertrend turns against the trade. 1 lot, optional day MTM target and day MTM SL, square off 15:14.",
    run: runNiftyEmaSupertrendBacktest,
  },
  nifty_ema_supertrend_rejection_option_buying: {
    title: "nifty_ema_supertrend_rejection_option_buying",
    description:
      "NIFTY EMA 5 / EMA 10 crossover with Supertrend (10, 1.5) confirmation, entered on a Supertrend LINE retest with rejection: a candle touches the line and closes on the trade's side of it → buy CE (bullish) or PE (bearish) at the next candle open, ATM or ITM1–ITM4. " +
      "Exit at the close of the candle where the Supertrend turns against the trade. 1 lot, optional day MTM target and day MTM SL, square off 15:14.",
    run: runNiftyEmaSupertrendRejectionBacktest,
  },
  nifty_supertrend_ema_buying_1min: {
    title: "nifty_supertrend_ema_buying_1min",
    description:
      "NIFTY option buying on EMA 5 / EMA 10 + Supertrend (10, 1.5) of the NIFTY index (1 / 3 / 5 / 15-min candles). First entry needs the close beyond the 09:16 reference line, later entries only Supertrend + EMA order. " +
      "ITM4 strike, lots 2, 4, 2, 4 ..., half the lots booked at Rs 3,000 trade profit, rest rides till the Supertrend flips. Day MTM target / SL (each on or off), square off 15:14.",
    run: runNiftySupertrendEmaBuying1minBacktest,
  },
};
