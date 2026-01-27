import WebSocket from "ws";
import { DHAN, INSTRUMENTS } from "../config/dhan.js";

export function connectFeed(onMessage) {
  const ws = new WebSocket(
    `wss://api-feed.dhan.co?version=2&token=1107425275&clientId=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJpc3MiOiJkaGFuIiwicGFydG5lcklkIjoiIiwiZXhwIjoxNzY3MjUzNzgwLCJpYXQiOjE3NjcxNjczODAsInRva2VuQ29uc3VtZXJUeXBlIjoiU0VMRiIsIndlYmhvb2tVcmwiOiIiLCJkaGFuQ2xpZW50SWQiOiIxMTA3NDI1Mjc1In0.DVxJGMKZILyOrCX4IdiWQgllp4fkAnKowZXFOzJ_Sj7kczELCSqNORu4wpFRkZuap3i9YPZqSr-9_Q7QOpXpWA&authType=1`
  );

  ws.on("open", () => {
    console.log("✅ WebSocket connected");

    // 🔔 SUBSCRIBE AFTER CONNECTION
const subscribeMsg = {
  RequestCode: 15,
  InstrumentCount: 1,
  InstrumentList: [
    {
      ExchangeSegment: "NSE_IDX",
      SecurityId: "26000"
    }
  ]
};


    ws.send(JSON.stringify(subscribeMsg));
    console.log("📡 Subscription request sent");
  });

  ws.on("message", onMessage);
  ws.on("error", console.error);
  ws.on("close", () => console.log("❌ WebSocket closed"));
}
