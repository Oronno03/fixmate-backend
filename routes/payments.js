import express from "express";
import PDFDocument from "pdfkit";
import Stripe from "stripe";
import {
  verifyCustomer,
  verifyTechnician,
  verifyToken,
} from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import { paymentCreateSchema } from "../config/validator.js";
import { toObjectId } from "../utils/helpers.js";

const PRO_PLAN_PRICE = 19;

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

  let insertedId;
  try {
    const result = await payments.insertOne(payment);
    insertedId = result.insertedId;
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
    {
      $set: {
        paymentStatus: "paid",
        paymentId: insertedId,
        paidAt: payment.paidAt,
        updatedAt: new Date(),
      },
    },
  );

  return { ...payment, _id: insertedId };
}

/**
 * Records a Pro subscription checkout and upgrades the technician account.
 *
 * @param {import("mongodb").Db} db
 * @param {import("stripe").Stripe.Checkout.Session} session
 */
async function recordProSubscription(db, session) {
  const users = db.collection("user");
  const payments = db.collection("payments");
  const email = session.metadata?.userEmail || session.customer_email;

  if (!email) {
    throw Object.assign(
      new Error("Missing technician email in Stripe metadata."),
      { status: 400 },
    );
  }

  const user = await users.findOne({ email });
  if (!user) {
    throw Object.assign(new Error("Technician not found."), { status: 404 });
  }

  const amount =
    typeof session.amount_total === "number"
      ? session.amount_total / 100
      : PRO_PLAN_PRICE;
  const paidAt = new Date();

  const payment = {
    bookingId: `pro:${email}`,
    kind: "subscription",
    plan: "pro",
    serviceTitle: "FixMate Pro Technician",
    customerName: user.name,
    customerEmail: email,
    technicianName: user.name,
    technicianEmail: email,
    amount,
    currency: session.currency || "usd",
    transactionId:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || "",
    stripeSessionId: session.id,
    paymentStatus: "paid",
    paidAt,
  };

  const saved = await payments.findOneAndUpdate(
    { bookingId: payment.bookingId },
    {
      $set: payment,
      $setOnInsert: { createdAt: paidAt },
    },
    { upsert: true, returnDocument: "after" },
  );

  await users.updateOne(
    { _id: user._id },
    { $set: { plan: "pro", planUpdatedAt: paidAt, updatedAt: paidAt } },
  );

  return saved;
}

/**
 * Streams a simple, print-friendly invoice PDF for a payment.
 *
 * @param {import("express").Response} res
 * @param {Record<string, any>} payment
 */
function sendInvoice(res, payment) {
  const invoiceNumber = String(payment._id ?? payment.stripeSessionId ?? "")
    .slice(-10)
    .toUpperCase();
  const paidAt = payment.paidAt ? new Date(payment.paidAt) : new Date();
  const amount = Number(payment.amount) || 0;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="fixmate-invoice-${invoiceNumber}.pdf"`,
  );

  const doc = new PDFDocument({ size: "A4", margin: 54 });
  doc.pipe(res);

  doc
    .fillColor("#11110F")
    .font("Helvetica-Bold")
    .fontSize(24)
    .text("FixMate");
  doc
    .fillColor("#8A6D14")
    .font("Helvetica")
    .fontSize(10)
    .text("Verified repair services");
  doc.moveDown(1.6);

  doc.fillColor("#11110F").font("Helvetica-Bold").fontSize(18).text("Invoice");
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#555555")
    .text(`Invoice no. ${invoiceNumber || "N/A"}`)
    .text(
      `Paid on ${new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(paidAt)}`,
    );
  doc.moveDown(1.4);

  const details = [
    ["Billed to", payment.customerName || payment.customerEmail || "Customer"],
    ["Email", payment.customerEmail || "—"],
    ["Technician", payment.technicianName || "—"],
    ["Service", payment.serviceTitle || "Repair service"],
    ["Transaction", payment.transactionId || "Confirmed by Stripe"],
  ];

  for (const [label, value] of details) {
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#555555")
      .text(`${label}: `, { continued: true })
      .font("Helvetica")
      .fillColor("#11110F")
      .text(String(value));
  }

  doc.moveDown(1.6);
  const tableTop = doc.y;
  doc
    .rect(54, tableTop, 487, 30)
    .fill("#F3EEDC")
    .fillColor("#11110F")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("Description", 64, tableTop + 10)
    .text("Amount", 450, tableTop + 10, { width: 80, align: "right" });

  doc
    .font("Helvetica")
    .fontSize(10)
    .text(payment.serviceTitle || "Repair service", 64, tableTop + 44, {
      width: 320,
    })
    .text(`$${amount.toFixed(2)}`, 450, tableTop + 44, {
      width: 80,
      align: "right",
    });

  doc
    .moveTo(54, tableTop + 74)
    .lineTo(541, tableTop + 74)
    .strokeColor("#DDD5C0")
    .stroke();

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor("#11110F")
    .text("Total paid", 360, tableTop + 88, { width: 100, align: "right" })
    .fillColor("#8A6D14")
    .text(`$${amount.toFixed(2)}`, 460, tableTop + 88, {
      width: 70,
      align: "right",
    });

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#777777")
    .text(
      "Thank you for choosing FixMate. This invoice was generated automatically for a completed and paid repair.",
      54,
      tableTop + 140,
      { width: 487 },
    );

  doc.end();
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
    "/pro/checkout",
    verifyToken(db),
    verifyTechnician,
    asyncHandler(async (req, res) => {
      const stripe = getStripe();
      if (!stripe) {
        return res
          .status(503)
          .json({ message: "Stripe is not configured on the server." });
      }

      if (req.user.plan === "pro") {
        return res
          .status(409)
          .json({ message: "You are already on the FixMate Pro plan." });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer_email: req.user.email,
        client_reference_id: req.user._id.toString(),
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: PRO_PLAN_PRICE * 100,
              recurring: { interval: "month" },
              product_data: { name: "FixMate Pro Technician" },
            },
            quantity: 1,
          },
        ],
        success_url: `${clientUrl}/dashboard/technician?pro=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${clientUrl}/dashboard/technician?pro=cancelled`,
        metadata: {
          kind: "pro-subscription",
          userEmail: req.user.email,
        },
        subscription_data: {
          metadata: {
            kind: "pro-subscription",
            userEmail: req.user.email,
          },
        },
      });

      return res.status(200).json({
        data: { url: session.url, sessionId: session.id },
      });
    }),
  );

  router.get(
    "/pro/verify",
    verifyToken(db),
    verifyTechnician,
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
      if (
        session.metadata?.kind !== "pro-subscription" ||
        session.metadata?.userEmail !== req.user.email
      ) {
        return res
          .status(403)
          .json({ message: "This subscription does not belong to you." });
      }

      if (
        session.status !== "complete" &&
        session.payment_status !== "paid" &&
        session.payment_status !== "no_payment_required"
      ) {
        return res
          .status(400)
          .json({ message: "The subscription checkout is not complete." });
      }

      const payment = await recordProSubscription(db, session);

      return res.status(200).json({
        data: { plan: "pro", payment },
        message: "FixMate Pro is now active.",
      });
    }),
  );

  router.get(
    "/booking/:bookingId/invoice",
    verifyToken(db),
    asyncHandler(async (req, res) => {
      const payment = await payments.findOne({
        bookingId: req.params.bookingId,
      });

      if (!payment) {
        return res.status(404).json({ message: "Invoice not found." });
      }

      const allowed =
        req.user.role === "admin" ||
        payment.customerEmail === req.user.email ||
        payment.technicianEmail === req.user.email;

      if (!allowed) {
        return res
          .status(403)
          .json({ message: "You cannot download this invoice." });
      }

      return sendInvoice(res, payment);
    }),
  );

  router.get(
    "/:id/invoice",
    verifyToken(db),
    asyncHandler(async (req, res) => {
      const _id = toObjectId(req.params.id);
      if (!_id) {
        return res.status(400).json({ message: "Invalid payment id." });
      }

      const payment = await payments.findOne({ _id });
      if (!payment) {
        return res.status(404).json({ message: "Invoice not found." });
      }

      const allowed =
        req.user.role === "admin" ||
        payment.customerEmail === req.user.email ||
        payment.technicianEmail === req.user.email;

      if (!allowed) {
        return res
          .status(403)
          .json({ message: "You cannot download this invoice." });
      }

      return sendInvoice(res, payment);
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
        if (event.data.object.metadata?.kind === "pro-subscription") {
          await recordProSubscription(db, event.data.object);
        } else {
          await recordPayment(db, event.data.object);
        }
      }

      return res.status(200).json({ received: true });
    }),
  );

  return router;
}
