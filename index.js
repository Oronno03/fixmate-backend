import express from "express";
import dotenv from "dotenv";
dotenv.config();

import cors from "cors";
import { connectToMongoDB } from "./config/db.js";
import { ensureIndexes } from "./config/indexes.js";
import serviceRoutes from "./routes/services.js";
import bookingRoutes from "./routes/bookings.js";
import paymentRoutes from "./routes/payments.js";
import userRoutes from "./routes/users.js";
import adminRoutes from "./routes/admin.js";
import uploadRoutes from "./routes/uploads.js";
import { errorHandler, notFound } from "./middleware/error.js";

const app = express();

const client = await connectToMongoDB();
const db = client.db(process.env.MONGODB_DB || "fixmate");
await ensureIndexes(db);

const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow server-to-server requests and configured browser origins.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Stripe webhooks need the raw request body, so this must be mounted before
// express.json().
app.use(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
);

app.use(express.json({ limit: "10mb" }));

app.get("/", (req, res) => {
  res.status(200).json({ message: "FixMate API is running." });
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/services", serviceRoutes(db));
app.use("/api/bookings", bookingRoutes(db));
app.use("/api/payments", paymentRoutes(db));
app.use("/api/users", userRoutes(db));
app.use("/api/admin", adminRoutes(db));
app.use("/api/uploads", uploadRoutes(db));

app.use(notFound);
app.use(errorHandler);

const port = Number(process.env.PORT) || 5000;

app.listen(port, () => {
  console.log(`FixMate API is running on port ${port}`);
});
