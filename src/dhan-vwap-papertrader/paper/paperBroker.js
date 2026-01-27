import { state } from "../strategy/state.js";

const CAPITAL = 50000;

export function enter(type, ltp) {
  state.active = true;
  state.direction = type;
  state.entryPrice = ltp;
  state.qty = Math.floor(CAPITAL / ltp);

  console.log(`📥 ENTER ${type} @ ${ltp}`);
}

export function updateMTM(ltp) {
  state.mtm = (ltp - state.entryPrice) * state.qty;
  console.log("MTM:", state.mtm);
}

export function exit(reason) {
  state.active = false;
  state.exited = true;
  console.log(`📤 EXIT | ${reason} | MTM: ${state.mtm}`);
}
