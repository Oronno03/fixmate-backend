import express from "express";
import {
  verifyCustomer,
  verifyTechnician,
  verifyToken,
} from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import {
  bookingCreateSchema,
  bookingStatus,
  bookingStatusUpdateSchema,
  reviewCreateSchema,
} from "../config/validator.js";
import { toObjectId } from "../utils/helpers.js";

const ACTIVE_STATUSES = ["requested", "accepted", "in-progress"];

/**
 * @param {import("mongodb").Db} db
 */
export default function bookingRoutes(db) {
  const router = express.Router();
  const bookings = db.collection("bookings");
  const services = db.collection("services");

  router.get(
    "/my",
    verifyToken(db),
    verifyCustomer,
    asyncHandler(async (req, res) => {
      const data = await bookings
        .find({ customerEmail: req.user.email })
        .sort({ createdAt: -1 })
        .toArray();

      return res.status(200).json({ data });
    }),
  );

  router.get(
    "/technician",
    verifyToken(db),
    verifyTechnician,
    asyncHandler(async (req, res) => {
      const query = { technicianEmail: req.user.email };

      if (req.query.status) {
        const parsed = bookingStatus.safeParse(req.query.status);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid status filter." });
        }
        query.status = parsed.data;
      }

      const data = await bookings
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();

      return res.status(200).json({ data });
    }),
  );

  router.get(
    "/:id",
    verifyToken(db),
    asyncHandler(async (req, res) => {
      const _id = toObjectId(req.params.id);
      if (!_id) {
        return res.status(400).json({ message: "Invalid booking id." });
      }

      const booking = await bookings.findOne({ _id });
      if (!booking) {
        return res.status(404).json({ message: "Booking not found." });
      }

      const isOwner =
        booking.customerEmail === req.user.email ||
        booking.technicianEmail === req.user.email;

      if (!isOwner && req.user.role !== "admin") {
        return res.status(403).json({ message: "You cannot view this booking." });
      }

      return res.status(200).json({ data: booking });
    }),
  );

  router.post(
    "/",
    verifyToken(db),
    verifyCustomer,
    asyncHandler(async (req, res) => {
      const parsed = bookingCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid booking data.",
          issues: parsed.error.issues,
        });
      }

      const { serviceId, customerPhone, address, preferredDate, problemDescription } =
        parsed.data;

      const _id = toObjectId(serviceId);
      if (!_id) {
        return res.status(400).json({ message: "Invalid service id." });
      }

      const service = await services.findOne({
        _id,
        approvalStatus: "approved",
        isAvailable: true,
      });

      if (!service) {
        return res
          .status(404)
          .json({ message: "Service not found or unavailable." });
      }

      if (service.technicianEmail === req.user.email) {
        return res
          .status(403)
          .json({ message: "You cannot request your own service." });
      }

      const activeRequest = await bookings.findOne({
        customerEmail: req.user.email,
        serviceId,
        status: { $in: ACTIVE_STATUSES },
      });

      if (activeRequest) {
        return res.status(409).json({
          message: "You already have an active request for this service.",
        });
      }

      const now = new Date();
      const booking = {
        serviceId,
        serviceTitle: service.title,
        serviceImage: service.image,
        category: service.category,
        basePrice: service.basePrice,
        technicianName: service.technicianName,
        technicianEmail: service.technicianEmail,
        customerName: req.user.name,
        customerEmail: req.user.email,
        customerPhone,
        address,
        preferredDate,
        problemDescription,
        status: "requested",
        statusHistory: [{ status: "requested", changedAt: now }],
        finalAmount: service.basePrice,
        paymentStatus: "unpaid",
        rating: null,
        review: null,
        reviewedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      const result = await bookings.insertOne(booking);

      return res.status(201).json({
        data: { ...booking, _id: result.insertedId },
        message: "Repair request sent.",
      });
    }),
  );

  router.patch(
    "/:id/cancel",
    verifyToken(db),
    verifyCustomer,
    asyncHandler(async (req, res) => {
      const _id = toObjectId(req.params.id);
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

      if (booking.status !== "requested") {
        return res.status(400).json({
          message: "Only bookings in the requested state can be cancelled.",
        });
      }

      const changedAt = new Date();
      const updated = await bookings.findOneAndUpdate(
        { _id, status: "requested" },
        {
          $set: { status: "cancelled", updatedAt: changedAt },
          $push: {
            statusHistory: { status: "cancelled", changedAt },
          },
        },
        { returnDocument: "after" },
      );

      if (!updated) {
        return res.status(409).json({
          message: "The booking status changed. Please refresh and try again.",
        });
      }

      return res
        .status(200)
        .json({ data: updated, message: "Booking cancelled." });
    }),
  );

  router.patch(
    "/:id/status",
    verifyToken(db),
    verifyTechnician,
    asyncHandler(async (req, res) => {
      const _id = toObjectId(req.params.id);
      if (!_id) {
        return res.status(400).json({ message: "Invalid booking id." });
      }

      const parsed = bookingStatusUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid status update.",
          issues: parsed.error.issues,
        });
      }

      const { status: nextStatus, finalAmount } = parsed.data;

      const booking = await bookings.findOne({ _id });
      if (!booking) {
        return res.status(404).json({ message: "Booking not found." });
      }

      if (booking.technicianEmail !== req.user.email) {
        return res
          .status(403)
          .json({ message: "You do not own this job." });
      }

      const allowedTransitions = {
        requested: ["accepted", "rejected"],
        accepted: ["in-progress"],
        "in-progress": ["completed"],
      };

      if (!allowedTransitions[booking.status]?.includes(nextStatus)) {
        return res.status(400).json({
          message: `Cannot change status from "${booking.status}" to "${nextStatus}".`,
        });
      }

      if (nextStatus === "completed" && !(finalAmount > 0)) {
        return res.status(400).json({
          message: "A positive final amount is required to complete the job.",
        });
      }

      const changedAt = new Date();
      const update = { status: nextStatus, updatedAt: changedAt };
      if (nextStatus === "completed") update.finalAmount = finalAmount;

      const updated = await bookings.findOneAndUpdate(
        { _id, status: booking.status },
        {
          $set: update,
          $push: {
            statusHistory: { status: nextStatus, changedAt },
          },
        },
        { returnDocument: "after" },
      );

      if (!updated) {
        return res.status(409).json({
          message: "The booking status changed. Please refresh and try again.",
        });
      }

      return res
        .status(200)
        .json({ data: updated, message: `Booking marked ${nextStatus}.` });
    }),
  );

  router.post(
    "/:id/review",
    verifyToken(db),
    verifyCustomer,
    asyncHandler(async (req, res) => {
      const _id = toObjectId(req.params.id);
      if (!_id) {
        return res.status(400).json({ message: "Invalid booking id." });
      }

      const parsed = reviewCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid review.",
          issues: parsed.error.issues,
        });
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

      if (booking.status !== "completed" || booking.paymentStatus !== "paid") {
        return res.status(400).json({
          message: "You can review a job after it is completed and paid.",
        });
      }

      if (typeof booking.rating === "number") {
        return res
          .status(409)
          .json({ message: "You have already reviewed this booking." });
      }

      const reviewedAt = new Date();
      const updated = await bookings.findOneAndUpdate(
        { _id, rating: null },
        {
          $set: {
            rating: parsed.data.rating,
            review: parsed.data.review,
            reviewedAt,
            updatedAt: reviewedAt,
          },
        },
        { returnDocument: "after" },
      );

      if (!updated) {
        return res
          .status(409)
          .json({ message: "This booking has already been reviewed." });
      }

      const [aggregate] = await bookings
        .aggregate([
          {
            $match: {
              serviceId: booking.serviceId,
              rating: { $type: "number" },
            },
          },
          {
            $group: {
              _id: null,
              average: { $avg: "$rating" },
              count: { $sum: 1 },
            },
          },
        ])
        .toArray();

      await services.updateOne(
        { _id: toObjectId(booking.serviceId) },
        {
          $set: {
            ratingAverage: aggregate
              ? Math.round(aggregate.average * 10) / 10
              : 0,
            ratingCount: aggregate?.count ?? 0,
            updatedAt: reviewedAt,
          },
        },
      );

      return res
        .status(201)
        .json({ data: updated, message: "Thanks for your review." });
    }),
  );

  return router;
}
