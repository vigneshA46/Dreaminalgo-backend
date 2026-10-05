import { Router } from 'express';
import  authenticate  from '../../middlewares/authenticate.js';
import  authorize  from '../../middlewares/authorize.js';
import * as userService from './users.service.js';

const router = Router();


router.post(
'/low-tokens',
authenticate,
async (req, res) => {
  const users = await userService.getUsersWithLowTokens();
  res.json(users);
}
);

/* USER SELF */
router.post('/me', authenticate, async (req, res) => {
const user = await userService.getMe(req.user.id);
res.json(user);
});

router.post('/user', authenticate, async (req, res) => {
const user = await userService.getMe(req.body.id);
res.json(user);
});

router.put('/me', authenticate, async (req, res) => {
const user = await userService.updateMe(req.user.id, req.body);
res.json(user);
});

/* ADMIN */
router.post(
'/',
authenticate,
async (req, res) => {
  const users = await userService.getAllUsers();
  res.json(users);
}
);


/* Activate / deactivate custom exit feature for a user
   body: { user_id, action: "activate" | "deactivate" } */
router.patch(
  '/custom-exit',
  authenticate,
  authorize('superadmin'),
  async (req, res) => {
    try {
      const { user_id, action } = req.body;

      if (!user_id || !['activate', 'deactivate'].includes(action)) {
        return res.status(400).json({
          success: false,
          message: 'user_id and action ("activate" or "deactivate") are required',
        });
      }

      const user = await userService.setCustomExit(user_id, action === 'activate');

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      res.json({
        success: true,
        message: `Custom exit ${action}d`,
        user,
      });
    } catch (error) {
      console.error('Set Custom Exit Error:', error);

      res.status(500).json({
        success: false,
        message: 'Failed to update custom exit',
      });
    }
  }
);


router.get(
  '/:id',
  authenticate,
  authorize('superadmin', 'courseadmin'),
  async (req, res) => {
    const user = await userService.getUserById(req.params.id);
    res.json(user);
  }
);


router.put(
  '/:id',
  authenticate,
  authorize('superadmin'),
  async (req, res) => {
    const user = await userService.updateUser(req.params.id, req.body);
    res.json(user);
  }
);

router.delete(
  '/:id',
  authenticate,
  authorize('superadmin'),
  async (req, res) => {
    await userService.deleteUser(req.params.id);
    res.json({ message: 'User deactivated' });
  }
);

export default router;
 