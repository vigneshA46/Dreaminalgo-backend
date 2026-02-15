export function parseHeader(buf) {
  return {
    code: buf.readUInt8(0),
    securityId: buf.readInt32LE(4)
  };
}

export function parseQuote(buf) {
  return {
    ltp: buf.readFloatLE(8),
    volume: buf.readInt32LE(22),
    ltt: buf.readInt32LE(14)
  };
}

export function parseTicker(buf) {
  return {
    ltp: buf.readFloatLE(8),
    ltt: buf.readInt32LE(12)
  };
}

export function parseDisconnect(buf) {
  return {
    reasonCode: buf.readInt16LE(8)
  };
}
 