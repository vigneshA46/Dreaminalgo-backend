import "./src/config/env.js"

import app from "./app.js";
import { initDB } from "./src/config/db.js";
import http from "http";
import { initSocket } from "./src/modules/websocket/socketServer.js";

const PORT = process.env.PORT || 5000;

(async () => {
  await initDB();

  // ✅ CREATE SERVER HERE (NOT in app.js)
  const server = http.createServer(app);

  // ✅ ATTACH SOCKET HERE
  initSocket(server);

  // ✅ START SERVER (NOT app.listen)
  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
})();