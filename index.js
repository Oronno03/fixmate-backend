import express, { json } from "express";
import dotenv from "dotenv";
dotenv.config();
import { connectToMongoDB } from "./config/db.js";
import cors from "cors";
import serviceRoutes from "./routes/services.js";
import bookingRoutes from "./routes/bookings.js";

const app = express();
const client = await connectToMongoDB();
const db = client.db("fixmate");
db.collection()

app.use(cors());
app.use(json());

app.get("/", (req, res) => {
    return res.status(200).send({message: "Server running."})
})

app.use("/services", serviceRoutes(db));
app.use("/bookings", bookingRoutes(db));

app.listen(5000);
console.log("App is running on port: 5000");
