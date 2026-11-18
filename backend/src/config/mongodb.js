// src/config/mongodb.js
// MongoDB connection using Mongoose

'use strict';

const mongoose = require('mongoose');
const logger = require('../utils/logger');

let isConnected = false;

/**
 * Connect to MongoDB using Mongoose
 * Uses async/await pattern
 */
async function connectMongoDB() {
  if (isConnected) {
    logger.info('MongoDB already connected');
    return;
  }

  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/linguawave';

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    isConnected = true;

    // Mongoose connection event listeners
    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
      isConnected = false;
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected. Attempting reconnect...');
      isConnected = false;
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
      isConnected = true;
    });

  } catch (error) {
    logger.error('MongoDB connection failed:', error.message);
    throw error;
  }
}

async function disconnectMongoDB() {
  if (isConnected) {
    await mongoose.disconnect();
    isConnected = false;
    logger.info('MongoDB disconnected');
  }
}

module.exports = { connectMongoDB, disconnectMongoDB, mongoose };
