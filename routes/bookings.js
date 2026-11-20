import express from "express";
import { Db, ObjectId } from "mongodb";
import { verifySession } from "../middleware/auth.js";
import z from "zod";
import { bookingSchema, paymentStatus } from "../config/validator.js";

/**
 *
 * @param {Db} db
 */
export default function bookingRoutes(db) {
  const router = express.Router();
  const bookings = db.collection("bookings");
  const services = db.collection("services");

  router.get("/", verifySession(db), async (req, res) => {
    const data = await bookings.find().toArray();
    if (data)
      return res
        .status(200)
        .json({ message: "Successfully got the bookings", bookings: data });
    else
      return res
        .status(500)
        .json({
          message: "Couldn't retrieve the bookings, please try again later.",
        });
  });

  router.get("/:id", verifySession(db), async (req, res) => {
    const id = req.params.id;

    try {
      const booking = await bookings.findOne({ _id: new ObjectId(id) });
      if (!booking)
        return res
          .status(404)
          .json({ message: "No booking found with that id" });

      return res.status(200).json({
        message: "Successfully retrieved the booking",
        booking,
      });
    } catch (err) {
      return res
        .status(400)
        .json({ message: "Some error occurred", error: err });
    }
  });

  router.post("/", verifySession(db), async (req, res) => {
    const body = req.body;

    try {
      const {
        serviceId,
        customerPhone,
        address,
        preferredDate,
        problemDescription,
      } = body;

      if (!serviceId)
        return res.status(400).json({ message: "serviceId is required." });

      const service = await services.findOne({
        _id: new ObjectId(serviceId),
        approvalStatus: "approved",
      });
      if (!service)
        return res.status(404).json({ message: "No service found." });

      const {
        _id,
        title: serviceTitle,
        image: serviceImage,
        category,
        basePrice,
        technicianName,
        technicianEmail,
      } = service;

      const customerName = req.user.name;
      const customerEmail = req.user.email;

      const data = bookingSchema.parse({
        serviceId: _id.toString(),
        serviceTitle,
        serviceImage,
        category,
        basePrice,
        technicianName,
        technicianEmail,
        customerName,
        customerEmail,
        customerPhone,
        address,
        problemDescription,
        preferredDate,
        status: "requested",
        paymentStatus: "unpaid",
        finalAmount: basePrice,
        createdAt: new Date(),
      });

      const inserted = await bookings.insertOne(data);

      res
        .status(201)
        .json({ message: "Successfully created the booking", data: inserted });
    } catch (err) {
      if (err instanceof z.ZodError) {
        console.dir("Invalid Data", err);
        return res.status(400).json({ message: "Invalid Data", error: err });
      } else {
        console.dir(err);
        return res
          .status(400)
          .json({ message: "Could not complete the booking!", error: err });
      }
    }
  });

  return router;
}
