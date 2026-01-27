import "./src/config/env.js"

import app from "./app.js";
import { initDB } from "./src/config/db.js";

const PORT = process.env.PORT || 5000;

(async () => {
  await initDB();

  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
})();
 