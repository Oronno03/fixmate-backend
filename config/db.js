import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is not set in the environment.");
}

const client = new MongoClient(process.env.MONGODB_URI);
let connected = false;

export async function connectToMongoDB() {
  if (!connected) {
    await client.connect();
    connected = true;
    console.log("You successfully connected to MongoDB!");
  }
  return client;
}

export { client };
