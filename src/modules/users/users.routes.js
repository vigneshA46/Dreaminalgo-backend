import { Router } from 'express';
import  authenticate  from '../../middlewares/authenticate.js';
import  authorize  from '../../middlewares/authorize.js';
import * as userService from './users.service.js';

const router = Router();

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
router.get(
'/',
authenticate,
authorize('Super Admin'),
async (req, res) => {
  const users = await userService.getAllUsers();
  res.json(users);
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
authorize('Super Admin', 'courseadmin'),
async (req, res) => {
  const user = await userService.updateUser(req.params.id, req.body);
  res.json(user);
}
);

router.delete(
'/:id',
authenticate,
authorize('Super Admin'),
async (req, res) => {
  await userService.deleteUser(req.params.id);
  res.json({ message: 'User deactivated' });
}
);

export default router;
 