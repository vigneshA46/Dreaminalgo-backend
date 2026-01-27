import dotenv from "dotenv";
dotenv.config();

export const DHAN = {
  TOKEN: process.env.DHAN_TOKEN,
  CLIENT_ID: process.env.DHAN_CLIENT_ID
};

export const INSTRUMENTS = {
  NIFTY_FUT: Number(process.env.NIFTY_FUT_ID),
  CE: Number(process.env.CE_OPTION_ID),
  PE: Number(process.env.PE_OPTION_ID)
};
