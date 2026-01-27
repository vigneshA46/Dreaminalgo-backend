import { calculateVWAP } from "../market/vwap.js";
import { state } from "./state.js";
import { enter, updateMTM, exit } from "../paper/paperBroker.js";

export function evaluate(candle, optionLtp) {
  if (state.exited) return;

  const vwap = calculateVWAP(candle);

  if (!state.active) {
    if (candle.close > vwap) enter("CE", optionLtp);
    if (candle.close < vwap) enter("PE", optionLtp);
  } else {
    updateMTM(optionLtp);

    if (state.mtm >= 3000) exit("TARGET");
    if (state.mtm <= -3000) exit("STOPLOSS");
  }
}
