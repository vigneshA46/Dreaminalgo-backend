import { connectFeed } from "./feed/websocket.js";
import { parseHeader, parseQuote, parseTicker , parseDisconnect} from "./feed/parser.js";
import { updateCandle, candles } from "./market/candleBuilder.js";
import { evaluate } from "./strategy/vwapStrategy.js";
import { INSTRUMENTS } from "./config/dhan.js";

let lastOptionLtp = 0;


connectFeed((buffer) => {
  const h = parseHeader(buffer);

  // DEBUG (remove later)
  console.log("📩 FeedCode:", h.code, "SecurityId:", h.securityId);

  if (h.code === 4 && h.securityId === INSTRUMENTS.NIFTY_FUT) {
    const tick = parseQuote(buffer);
    updateCandle(tick);

    if (candles.length > 0 && lastOptionLtp > 0) {
      evaluate(candles.at(-1), lastOptionLtp);
    }
  }

  if (
    h.code === 2 &&
    (h.securityId === INSTRUMENTS.CE || h.securityId === INSTRUMENTS.PE)
  ) {
    lastOptionLtp = parseTicker(buffer).ltp;
  }

    if (h.code === 50) {
    const d = parseDisconnect(buffer);
    console.error("❌ DISCONNECTED BY DHAN | Reason Code:", d.reasonCode);
    return;
  }

  console.log("📩 FeedCode:", h.code, "SecurityId:", h.securityId);
});
 