import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import morgan from 'morgan';

import authRoutes from './src/modules/auth/auth.routes.js';
import authAdmin from './src/modules/admin-auth/admin.auth.routes.js';
import adminRoutes from './src/modules/admin/admin.routes.js';
import userRoutes from './src/modules/users/users.routes.js';
import brokerRoutes from './src/modules/broker/broker.routes.js';
import stratergyRoutes from './src/modules/strategy/strategy.routes.js'
 
const app = express();

/* Security */
app.use(helmet());

/* Logging */
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

/* CORS */
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);

/* Parsers */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* 👉 ROUTES */

app.use('/api/auth',authRoutes);
app.use('/api/adminauth',authAdmin);
app.use('/api/admin',adminRoutes);
app.use('/api/users',userRoutes);
app.use('/api/broker',brokerRoutes);
app.use('/api/stratergy',stratergyRoutes);

/* Health Check */
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date() });
});

export default app;
 