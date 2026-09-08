import pool from "../../config/db.js";


/*
  CREATE EXPENSE / INCOME

  Body:
  {
    date: "2026-09-08",
    type: "expense",
    amount: 5000,
    notes: "Office expenses"
  }
*/

export const createExpenseIncome = async (req, res) => {
  try {
    const {
      date,
      type,
      amount,
      notes
    } = req.body;

    // Validate type
    if (!type) {
      return res.status(400).json({
        error: "Type is required"
      });
    }

    if (!["expense", "income"].includes(type)) {
      return res.status(400).json({
        error: "Type must be either expense or income"
      });
    }

    // Validate amount
    if (amount === undefined || amount === null || amount === "") {
      return res.status(400).json({
        error: "Amount is required"
      });
    }

    if (Number(amount) <= 0) {
      return res.status(400).json({
        error: "Amount must be greater than 0"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO expenses_income
      (
        date,
        type,
        amount,
        notes
      )
      VALUES
      (
        COALESCE($1, CURRENT_DATE),
        $2,
        $3,
        $4
      )
      RETURNING *
      `,
      [
        date || null,
        type,
        amount,
        notes || null
      ]
    );

    res.status(201).json({
      message: `${type === "expense" ? "Expense" : "Income"} created successfully`,
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Create Expense/Income Error:", error);

    res.status(500).json({
      error: "Server error"
    });
  }
};


/*
  GET EXPENSES / INCOMES BETWEEN DATES

  Query:
  startDate
  endDate
  type (optional)

  Example:

  GET /api/expenses?startDate=2026-09-01&endDate=2026-09-08

  OR

  GET /api/expenses?startDate=2026-09-01&endDate=2026-09-08&type=expense
*/

export const getExpensesIncome = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      type
    } = req.query;

    let values = [];
    let query = `
      SELECT *
      FROM expenses_income
      WHERE 1 = 1
    `;

    /*
      DATE FILTER
    */

    if (startDate) {
      values.push(startDate);

      query += `
        AND date >= $${values.length}
      `;
    }

    if (endDate) {
      values.push(endDate);

      query += `
        AND date <= $${values.length}
      `;
    }

    /*
      TYPE FILTER
    */

    if (type) {

      if (!["expense", "income"].includes(type)) {
        return res.status(400).json({
          error: "Type must be either expense or income"
        });
      }

      values.push(type);

      query += `
        AND type = $${values.length}
      `;
    }

    /*
      ORDER BY DATE
    */

    query += `
      ORDER BY date DESC, id DESC
    `;

    const result = await pool.query(query, values);

    /*
      TOTAL EXPENSE
    */

    let totalExpenseQuery = `
      SELECT COALESCE(SUM(amount), 0) AS total_expense
      FROM expenses_income
      WHERE type = 'expense'
    `;

    let totalExpenseValues = [];

    if (startDate) {
      totalExpenseValues.push(startDate);

      totalExpenseQuery += `
        AND date >= $${totalExpenseValues.length}
      `;
    }

    if (endDate) {
      totalExpenseValues.push(endDate);

      totalExpenseQuery += `
        AND date <= $${totalExpenseValues.length}
      `;
    }

    /*
      TOTAL INCOME
    */

    let totalIncomeQuery = `
      SELECT COALESCE(SUM(amount), 0) AS total_income
      FROM expenses_income
      WHERE type = 'income'
    `;

    let totalIncomeValues = [];

    if (startDate) {
      totalIncomeValues.push(startDate);

      totalIncomeQuery += `
        AND date >= $${totalIncomeValues.length}
      `;
    }

    if (endDate) {
      totalIncomeValues.push(endDate);

      totalIncomeQuery += `
        AND date <= $${totalIncomeValues.length}
      `;
    }

    const [
      totalExpenseResult,
      totalIncomeResult
    ] = await Promise.all([
      pool.query(totalExpenseQuery, totalExpenseValues),
      pool.query(totalIncomeQuery, totalIncomeValues)
    ]);

    const totalExpense =
      Number(totalExpenseResult.rows[0].total_expense || 0);

    const totalIncome =
      Number(totalIncomeResult.rows[0].total_income || 0);

    const balance = totalIncome - totalExpense;

    res.json({
      data: result.rows,

      summary: {
        total_expense: totalExpense,
        total_income: totalIncome,
        balance
      }
    });

  } catch (error) {
    console.error("Get Expenses/Income Error:", error);

    res.status(500).json({
      error: "Server error"
    });
  }
};


/*
  UPDATE EXPENSE / INCOME

  Body can contain:

  {
    date: "2026-09-08",
    type: "income",
    amount: 10000,
    notes: "Updated note"
  }

  All fields are optional.
*/

export const updateExpenseIncome = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      date,
      type,
      amount,
      notes
    } = req.body;

    /*
      Validate type if provided
    */

    if (
      type !== undefined &&
      !["expense", "income"].includes(type)
    ) {
      return res.status(400).json({
        error: "Type must be either expense or income"
      });
    }

    /*
      Validate amount if provided
    */

    if (
      amount !== undefined &&
      amount !== null &&
      amount !== "" &&
      Number(amount) <= 0
    ) {
      return res.status(400).json({
        error: "Amount must be greater than 0"
      });
    }

    const result = await pool.query(
      `
      UPDATE expenses_income
      SET
        date = COALESCE($1, date),
        type = COALESCE($2, type),
        amount = COALESCE($3, amount),
        notes = COALESCE($4, notes)

      WHERE id = $5

      RETURNING *
      `,
      [
        date,
        type,
        amount,
        notes,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Expense or income not found"
      });
    }

    res.json({
      message: "Expense/Income updated successfully",
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Update Expense/Income Error:", error);

    res.status(500).json({
      error: "Server error"
    });
  }
};


/*
  DELETE EXPENSE / INCOME
*/

export const deleteExpenseIncome = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      DELETE FROM expenses_income
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Expense or income not found"
      });
    }

    res.json({
      message: "Expense/Income deleted successfully",
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Delete Expense/Income Error:", error);

    res.status(500).json({
      error: "Server error"
    });
  }
};
