import express from "express";
import { verifyAdmin, verifyToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import {
  approvalStatusSchema,
  approvalUpdateSchema,
  bookingStatus,
  roleUpdateSchema,
} from "../config/validator.js";
import { sanitizeUser, toObjectId } from "../utils/helpers.js";

/**
 * @param {import("mongodb").Db} db
 */
export default function adminRoutes(db) {
  const router = express.Router();
  const users = db.collection("user");
  const services = db.collection("services");
  const bookings = db.collection("bookings");
  const payments = db.collection("payments");

  router.use(verifyToken(db), verifyAdmin);

  router.get(
    "/users",
    asyncHandler(async (req, res) => {
      const data = await users
        .find({}, { projection: { password: 0 } })
        .sort({ createdAt: -1 })
        .toArray();

      return res.status(200).json({ data: data.map(sanitizeUser) });
    }),
  );

  router.patch(
    "/users/:id/role",
    asyncHandler(async (req, res) => {
      const _id = toObjectId(req.params.id);
      if (!_id) {
        return res.status(400).json({ message: "Invalid user id." });
      }

      if (_id.equals(req.user._id)) {
        return res
          .status(400)
          .json({ message: "You cannot change your own role." });
      }

      const parsed = roleUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid role.",
          issues: parsed.error.issues,
        });
      }

      const updated = await users.findOneAndUpdate(
        { _id },
        { $set: { role: parsed.data.role, updatedAt: new Date() } },
        { returnDocument: "after" },
      );

      if (!updated) {
        return res.status(404).json({ message: "User not found." });
      }

      return res.status(200).json({
        data: sanitizeUser(updated),
        message: "User role updated.",
      });
    }),
  );

  router.get(
    "/services",
    asyncHandler(async (req, res) => {
      const query = {};

      if (req.query.status) {
        const parsed = approvalStatusSchema.safeParse(req.query.status);
        if (!parsed.success) {
          return res
            .status(400)
            .json({ message: "Invalid approval status filter." });
        }
        query.approvalStatus = parsed.data;
      }

      const data = await services
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();

      return res.status(200).json({ data });
    }),
  );

  router.patch(
    "/services/:id/approval",
    asyncHandler(async (req, res) => {
      const _id = toObjectId(req.params.id);
      if (!_id) {
        return res.status(400).json({ message: "Invalid service id." });
      }

      const parsed = approvalUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid approval status.",
          issues: parsed.error.issues,
        });
      }

      const updated = await services.findOneAndUpdate(
        { _id },
        {
          $set: {
            approvalStatus: parsed.data.approvalStatus,
            updatedAt: new Date(),
          },
        },
        { returnDocument: "after" },
      );

      if (!updated) {
        return res.status(404).json({ message: "Service not found." });
      }

      return res.status(200).json({
        data: updated,
        message: `Service ${parsed.data.approvalStatus}.`,
      });
    }),
  );

  router.get(
    "/bookings",
    asyncHandler(async (req, res) => {
      const query = {};

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
    "/payments",
    asyncHandler(async (req, res) => {
      const data = await payments.find().sort({ paidAt: -1 }).toArray();
      const totalRevenue = data.reduce(
        (total, payment) => total + (Number(payment.amount) || 0),
        0,
      );

      return res.status(200).json({ data, totalRevenue });
    }),
  );

  router.get(
    "/stats",
    asyncHandler(async (req, res) => {
      const [
        totalUsers,
        totalTechnicians,
        totalCustomers,
        pendingServices,
        totalBookings,
        revenue,
        bookingsByStatus,
        revenueByMonth,
        servicesByCategory,
      ] = await Promise.all([
        users.countDocuments(),
        users.countDocuments({ role: "technician" }),
        users.countDocuments({ role: "customer" }),
        services.countDocuments({ approvalStatus: "pending" }),
        bookings.countDocuments(),
        payments
          .aggregate([
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ])
          .toArray(),
        bookings
          .aggregate([
            { $group: { _id: "$status", count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ])
          .toArray(),
        payments
          .aggregate([
            {
              $group: {
                _id: {
                  $dateToString: { format: "%Y-%m", date: "$paidAt" },
                },
                total: { $sum: "$amount" },
              },
            },
            { $sort: { _id: 1 } },
          ])
          .toArray(),
        services
          .aggregate([
            { $group: { _id: "$category", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ])
          .toArray(),
      ]);

      return res.status(200).json({
        data: {
          totalUsers,
          totalTechnicians,
          totalCustomers,
          pendingServices,
          totalBookings,
          totalRevenue: revenue[0]?.total || 0,
          bookingsByStatus,
          revenueByMonth,
          servicesByCategory,
        },
      });
    }),
  );

  return router;
}
