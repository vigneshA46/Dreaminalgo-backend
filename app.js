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
import papertradeRoutes  from "./src/modules/logger/papertrade.routes.js";
import traderSignalRoutes from "./src/modules/tradersingal/tradersignal.routes.js";
import instrumentRoutes from "./src/modules/instruments/instruments.routes.js";
import createStrategyRoutes from "./src/modules/createstartergy/createstartergy.routes.js";
import telemetryRoute from "./src/modules/websocket/telemetry.route.js";
import tradeLegRoutes from "./src/modules/tradelegs/tradeleg.routes.js";
import deploymentroutes from "./src/modules/deployments/deployments.routes.js"
import realtraderoutes from "./src/modules/realtrades/realtrades.routes.js"
import realtragroupderoutes from "./src/modules/realtradegroups/realTradeGroups.routes.js"
import tutorialroutes from "./src/modules/tutorials/tutorials.routes.js"
import reportsroutes from "./src/modules/reports/reports.routes.js"
import couponroutes from "./src/modules/coupons/coupons.routes.js"
import statisticsroutes from "./src/modules/statistics/statistics.routes.js"
//#import './src/modules/jobs/deploymentCron.js'

const app = express();


/* Security */
app.use(helmet());
app.set("trust proxy", 1);

/* Logging */
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

/* setTimeout(() => {
  console.log("Running startup deployment sync...");
}, 5000);
 */

/* CORS */
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5500",
  "https://dreaminalgo.pages.dev",
  "https://dreaminalgo-frontend.vercel.app/",
  "https://algo.dreamintraders.in",
  "https://dreaminalgo-admin.pages.dev",
  "https://hasan3324algoadmin.dreamintraders.in"
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
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
app.use('/api/paperlogger',papertradeRoutes);
app.use('/api/trader-signal', traderSignalRoutes);
app.use('/api/instruments', instrumentRoutes);
app.use('/api/createstartergy',createStrategyRoutes);
app.use('/api/tradelegs',tradeLegRoutes);
app.use('/api/deployments',deploymentroutes);
app.use('/api/realtrades',realtraderoutes);
app.use('/api/realtradegroups',realtragroupderoutes);
app.use('/api/tutorials',tutorialroutes);
app.use('/api/reports',reportsroutes);
app.use('/api/coupons',couponroutes);
app.use('/api/statistics',statisticsroutes);
app.use("/api/", telemetryRoute);


/* Health Check */
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date() });
});

export default app;
 