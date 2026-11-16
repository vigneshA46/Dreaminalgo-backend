/**
 * Every strategy that has a backtest engine.
 * key = the admin API route name (/api/backtest/<key>) and the id used for user access.
 * title / description seed the backtest_strategies table; admins can edit them there.
 */

import { runPivotOptionBuyingCumBacktest } from "./backtest.service.js";
import { runNiftyOptionPivotBufferBacktest } from "./pivotBuffer.service.js";
import { runNiftyOptionPivotFixedTargetBacktest } from "./pivotFixedTarget.service.js";
import { runNiftyOptionLevelBreakoutBacktest } from "./levelBreakout.service.js";
import { runNiftyHourlyRangeTouchBacktest, runNiftyHourlyRangeTouch1mBacktest } from "./hourlyRange.service.js";

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
      "3-min close above buy above → 1 lot, SL entry − 20 until T1, then trail on 3-min close below the last target touched.",
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
};
