import * as tokenlogsService from './tokenlogs.service.js';


export const getAllTokenLogs = async (req, res) => {
  try {

    const logs = await tokenlogsService.getAllTokenLogs({
      search: req.query.search,
      user_id: req.query.user_id,
      from_date: req.query.from_date,
      to_date: req.query.to_date,
    });

    res.json(logs);

  } catch (error) {

    console.error('Error fetching token logs:', error);

    res.status(500).json({
      message: 'Failed to fetch token logs',
    });

  }
};