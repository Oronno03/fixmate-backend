import express from "express";
import Stripe from "stripe";
import { verifyCustomer, verifyToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import { paymentCreateSchema } from "../config/validator.js";
import { toObjectId } from "../utils/helpers.js";

const clientUrl = (process.env.CLIENT_URL || "http://localhost:3000")
  .split(",")[0]
  .trim();

let stripeClient = null;

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

/**
 * @param {import("mongodb").Db} db
 * @param {import("stripe").Stripe.Checkout.Session} session
 * @param {{ expectedCustomerEmail?: string }} [options]
 */
async function recordPayment(db, session, options = {}) {
  const bookings = db.collection("bookings");
  const payments = db.collection("payments");

  const bookingId = session.metadata?.bookingId;
  if (!bookingId) {
    throw Object.assign(new Error("Missing bookingId in Stripe metadata."), {
      status: 400,
    });
  }

  const _id = toObjectId(bookingId);
  if (!_id) {
    throw Object.assign(new Error("Invalid bookingId in Stripe metadata."), {
      status: 400,
    });
  }

  const booking = await bookings.findOne({ _id });
  if (!booking) {
    throw Object.assign(new Error("Booking not found."), { status: 404 });
  }

  if (
    options.expectedCustomerEmail &&
    booking.customerEmail !== options.expectedCustomerEmail
  ) {
    throw Object.assign(
      new Error("This payment does not belong to the current user."),
      { status: 403 },
    );
  }

  const existing = await payments.findOne({ stripeSessionId: session.id });
  if (existing) return existing;

  const existingForBooking = await payments.findOne({ bookingId });
  if (existingForBooking) return existingForBooking;

  const amount =
    typeof session.amount_total === "number"
      ? session.amount_total / 100
      : Number(booking.finalAmount);

  const payment = {
    bookingId,
    serviceTitle: booking.serviceTitle,
    customerName: booking.customerName,
    customerEmail: booking.customerEmail,
    technicianName: booking.technicianName,
    technicianEmail: booking.technicianEmail,
    amount,
    currency: session.currency || "usd",
    transactionId:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || "",
    stripeSessionId: session.id,
    paymentStatus: "paid",
    paidAt: new Date(),
  };

  try {
    await payments.insertOne(payment);
  } catch (error) {
    if (error?.code === 11000) {
      const duplicate = await payments.findOne({
        $or: [{ stripeSessionId: session.id }, { bookingId }],
      });
      if (duplicate) return duplicate;
    }
    throw error;
  }

  await bookings.updateOne(
    { _id },
    { $set: { paymentStatus: "paid", updatedAt: new Date() } },
  );

  return payment;
}

/**
 * @param {import("mongodb").Db} db
 */
export default function paymentRoutes(db) {
  const router = express.Router();
  const bookings = db.collection("bookings");
  const payments = db.collection("payments");

  router.post(
    "/create-checkout-session",
    verifyToken(db),
    verifyCustomer,
    asyncHandler(async (req, res) => {
      const stripe = getStripe();
      if (!stripe) {
        return res
          .status(503)
          .json({ message: "Stripe is not configured on the server." });
      }

      const parsed = paymentCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid payment request.",
          issues: parsed.error.issues,
        });
      }

      const _id = toObjectId(parsed.data.bookingId);
      if (!_id) {
        return res.status(400).json({ message: "Invalid booking id." });
      }

      const booking = await bookings.findOne({ _id });
      if (!booking) {
        return res.status(404).json({ message: "Booking not found." });
      }

      if (booking.customerEmail !== req.user.email) {
        return res
          .status(403)
          .json({ message: "You do not own this booking." });
      }

      if (booking.status !== "completed") {
        return res
          .status(400)
          .json({ message: "Only completed bookings can be paid." });
      }

      if (booking.paymentStatus === "paid") {
        return res
          .status(409)
          .json({ message: "This booking is already paid." });
      }

      const existingPayment = await payments.findOne({
        bookingId: parsed.data.bookingId,
      });
      if (existingPayment) {
        return res
          .status(409)
          .json({ message: "A payment already exists for this booking." });
      }

      const amount = Math.round(Number(booking.finalAmount) * 100);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res
          .status(400)
          .json({ message: "The booking has an invalid final amount." });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: req.user.email,
        client_reference_id: parsed.data.bookingId,
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: amount,
              product_data: { name: booking.serviceTitle },
            },
            quantity: 1,
          },
        ],
        success_url: `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${clientUrl}/payment/cancel`,
        metadata: {
          bookingId: parsed.data.bookingId,
          customerEmail: req.user.email,
        },
      });

      return res.status(200).json({
        data: { url: session.url, sessionId: session.id },
      });
    }),
  );

  router.get(
    "/verify",
    verifyToken(db),
    verifyCustomer,
    asyncHandler(async (req, res) => {
      const stripe = getStripe();
      if (!stripe) {
        return res
          .status(503)
          .json({ message: "Stripe is not configured on the server." });
      }

      const sessionId = req.query.session_id;
      if (typeof sessionId !== "string" || !sessionId) {
        return res.status(400).json({ message: "session_id is required." });
      }

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status !== "paid") {
        return res
          .status(400)
          .json({ message: "Payment has not been completed." });
      }

      const payment = await recordPayment(db, session, {
        expectedCustomerEmail: req.user.email,
      });

      return res
        .status(200)
        .json({ data: payment, message: "Payment verified." });
    }),
  );

  router.get(
    "/my",
    verifyToken(db),
    verifyCustomer,
    asyncHandler(async (req, res) => {
      const data = await payments
        .find({ customerEmail: req.user.email })
        .sort({ paidAt: -1 })
        .toArray();

      return res.status(200).json({ data });
    }),
  );

  router.post(
    "/webhook",
    asyncHandler(async (req, res) => {
      const stripe = getStripe();
      if (!stripe) {
        return res
          .status(503)
          .json({ message: "Stripe is not configured on the server." });
      }

      const signature = req.headers["stripe-signature"];
      if (!signature) {
        return res.status(400).json({ message: "Missing Stripe signature." });
      }

      let event;
      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          signature,
          process.env.STRIPE_WEBHOOK_SECRET,
        );
      } catch (error) {
        return res.status(400).json({
          message: `Webhook signature verification failed: ${error.message}`,
        });
      }

      if (event.type === "checkout.session.completed") {
        await recordPayment(db, event.data.object);
      }

      return res.status(200).json({ received: true });
    }),
  );

  return router;
}
