import dotenv from "dotenv";

dotenv.config();

if (!process.env.DB_PASSWORD) {
  console.error("❌ ENV NOT LOADED — DB_PASSWORD missing");
  process.exit(1);
}

export {};