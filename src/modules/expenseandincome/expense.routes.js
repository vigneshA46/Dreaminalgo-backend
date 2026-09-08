import { Router } from "express";

import authenticate from "../../middlewares/authenticate.js";
import authorize from "../../middlewares/authorize.js";

import * as expenseController from "./expense.controller.js";

const router = Router();

/*
  CREATE EXPENSE / INCOME
  Admin Only
*/

router.post(
  "/",
  authenticate,
  authorize("superadmin", "admin"),
  expenseController.createExpenseIncome
);

/*
  GET EXPENSES / INCOMES BETWEEN DATES
  Admin Only

  Example:
  GET /api/expenses?startDate=2026-09-01&endDate=2026-09-08
*/

router.get(
  "/",
  authenticate,
  authorize("superadmin", "admin"),
  expenseController.getExpensesIncome
);

/*
  UPDATE EXPENSE / INCOME
  Admin Only
*/

router.patch(
  "/:id",
  authenticate,
  authorize("superadmin", "admin"),
  expenseController.updateExpenseIncome
);

/*
  DELETE EXPENSE / INCOME
  Admin Only
*/

router.delete(
  "/:id",
  authenticate,
  authorize("superadmin", "admin"),
  expenseController.deleteExpenseIncome
);

export default router;
