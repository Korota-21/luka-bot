const mongoose = require('mongoose');
const config = require('../config');

async function connectDB() {
  mongoose.connection.on('disconnected', () => console.warn('Database connection lost'));
  mongoose.connection.on('reconnected', () => console.log('Database reconnected'));

  await mongoose.connect(config.mongoUri);
  console.log('Connected to MongoDB');
}

module.exports = { connectDB };
