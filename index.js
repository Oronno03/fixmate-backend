import express, { json } from "express";
import dotenv from "dotenv";
dotenv.config();
import { connectToMongoDB } from "./db.js";
import cors from "cors";

const app = express();
const client = connectToMongoDB();

app.use(cors());
app.use(json());

app.get("/", (req, res) => {
    return res.status(200).send({message: "Server running."})
})

app.listen(5000);
console.log("App is running on port: 5000");
