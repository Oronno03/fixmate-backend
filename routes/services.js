import express from "express";
import { verifyTechnician, verifyToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import {
  availabilityUpdateSchema,
  serviceCreateSchema,
  serviceQuerySchema,
  serviceUpdateSchema,
} from "../config/validator.js";
import { escapeRegex, toObjectId } from "../utils/helpers.js";

/**
 * @param {import("mongodb").Db} db
 */
export default function serviceRoutes(db) {
  const router = express.Router();
  const services = db.collection("services");

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = serviceQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid query parameters.",
          issues: parsed.error.issues,
        });
      }

      const { search, category, serviceMode, minPrice, maxPrice, sort, limit } =
        parsed.data;

      const query = {
        approvalStatus: "approved",
        isAvailable: true,
      };

      if (search) {
        const regex = { $regex: escapeRegex(search), $options: "i" };
        query.$or = [{ title: regex }, { category: regex }];
      }

      if (category) query.category = category;
      if (serviceMode) query.serviceMode = serviceMode;

      if (minPrice !== undefined || maxPrice !== undefined) {
        query.basePrice = {};
        if (minPrice !== undefined) query.basePrice.$gte = minPrice;
        if (maxPrice !== undefined) query.basePrice.$lte = maxPrice;
      }

      const sortOption =
        sort === "price_asc"
          ? { basePrice: 1 }
          : sort === "price_desc"
            ? { basePrice: -1 }
            : { createdAt: -1 };

      let cursor = services.find(query).sort(sortOption);
      if (limit) cursor = cursor.limit(limit);

      const data = await cursor.toArray();
      return res.status(200).json({ data });
    }),
  );

  router.get(
    "/technician",
    verifyToken(db),
    verifyTechnician,
    asyncHandler(async (req, res) => {
      const data = await services
        .find({ technicianEmail: req.user.email })
        .sort({ createdAt: -1 })
        .toArray();

      return res.status(200).json({ data });
    }),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const _id = toObjectId(req.params.id);
      if (!_id) {
        return res.status(400).json({ message: "Invalid service id." });
      }

      const service = await services.findOne({
        _id,
        approvalStatus: "approved",
        isAvailable: true,
      });

      if (!service) {
        return res.status(404).json({ message: "Service not found." });
      }

      return res.status(200).json({ data: service });
    }),
  );

  router.post(
    "/",
    verifyToken(db),
    verifyTechnician,
    asyncHandler(async (req, res) => {
      const parsed = serviceCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid service data.",
          issues: parsed.error.issues,
        });
      }

      const now = new Date();
      const service = {
        ...parsed.data,
        technicianName: req.user.name,
        technicianEmail: req.user.email,
        approvalStatus: "pending",
        isAvailable: true,
        createdAt: now,
        updatedAt: now,
      };

      const result = await services.insertOne(service);

      return res.status(201).json({
        data: { ...service, _id: result.insertedId },
        message: "Service created. It is waiting for admin approval.",
      });
    }),
  );

  router.patch(
    "/:id",
    verifyToken(db),
    verifyTechnician,
    asyncHandler(async (req, res) => {
      const _id = toObjectId(req.params.id);
      if (!_id) {
        return res.status(400).json({ message: "Invalid service id." });
      }

      const parsed = serviceUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid service data.",
          issues: parsed.error.issues,
        });
      }

      const service = await services.findOne({ _id });
      if (!service) {
        return res.status(404).json({ message: "Service not found." });
      }

      if (service.technicianEmail !== req.user.email) {
        return res
          .status(403)
          .json({ message: "You do not own this service." });
      }

      const updated = await services.findOneAndUpdate(
        { _id },
        {
          $set: {
            ...parsed.data,
            approvalStatus: "pending",
            updatedAt: new Date(),
          },
        },
        { returnDocument: "after" },
      );

      return res.status(200).json({
        data: updated,
        message: "Service updated. It now needs admin approval again.",
      });
    }),
  );

  router.patch(
    "/:id/availability",
    verifyToken(db),
    verifyTechnician,
    asyncHandler(async (req, res) => {
      const _id = toObjectId(req.params.id);
      if (!_id) {
        return res.status(400).json({ message: "Invalid service id." });
      }

      const parsed = availabilityUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid availability value.",
          issues: parsed.error.issues,
        });
      }

      const service = await services.findOne({ _id });
      if (!service) {
        return res.status(404).json({ message: "Service not found." });
      }

      if (service.technicianEmail !== req.user.email) {
        return res
          .status(403)
          .json({ message: "You do not own this service." });
      }

      const updated = await services.findOneAndUpdate(
        { _id },
        {
          $set: {
            isAvailable: parsed.data.isAvailable,
            updatedAt: new Date(),
          },
        },
        { returnDocument: "after" },
      );

      return res.status(200).json({
        data: updated,
        message: `Service ${parsed.data.isAvailable ? "enabled" : "disabled"}.`,
      });
    }),
  );

  router.delete(
    "/:id",
    verifyToken(db),
    verifyTechnician,
    asyncHandler(async (req, res) => {
      const _id = toObjectId(req.params.id);
      if (!_id) {
        return res.status(400).json({ message: "Invalid service id." });
      }

      const service = await services.findOne({ _id });
      if (!service) {
        return res.status(404).json({ message: "Service not found." });
      }

      if (service.technicianEmail !== req.user.email) {
        return res
          .status(403)
          .json({ message: "You do not own this service." });
      }

      await services.deleteOne({ _id });
      return res.status(200).json({ message: "Service deleted." });
    }),
  );

  return router;
}
