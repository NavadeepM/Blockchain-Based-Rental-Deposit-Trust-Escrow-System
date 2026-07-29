const mongoose = require("mongoose");

async function connectDB() {
  try {
    mongoose.set("strictQuery", true);
    await mongoose.connect(process.env.MONGO_URI, {
      autoIndex: true,
    });
    console.log(`[MongoDB] connected -> ${mongoose.connection.host}`);
  } catch (err) {
    console.error("[MongoDB] connection error:", err.message);
    process.exit(1);
  }
}

module.exports = connectDB;
