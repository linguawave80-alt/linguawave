// src/utils/fileStream.js
// File operations using Node.js fs module, streams, and zlib compression

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline, Transform } = require('stream');
const { promisify } = require('util');
const logger = require('./logger');

const pipelineAsync = promisify(pipeline);

/**
 * Compress a file using gzip (zlib + streams)
 * @param {string} inputPath
 * @param {string} outputPath
 * @returns {Promise<void>}
 */
async function compressFile(inputPath, outputPath) {
  const readStream = fs.createReadStream(inputPath);
  const writeStream = fs.createWriteStream(outputPath);
  const gzip = zlib.createGzip({ level: 6 });

  await pipelineAsync(readStream, gzip, writeStream);
  logger.info(`Compressed: ${inputPath} → ${outputPath}`);
}

/**
 * Decompress a gzip file
 */
async function decompressFile(inputPath, outputPath) {
  const readStream = fs.createReadStream(inputPath);
  const writeStream = fs.createWriteStream(outputPath);
  const gunzip = zlib.createGunzip();

  await pipelineAsync(readStream, gunzip, writeStream);
  logger.info(`Decompressed: ${inputPath} → ${outputPath}`);
}

/**
 * Read file using callback pattern (traditional Node.js)
 */
function readFileCallback(filePath, callback) {
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) return callback(err);
    callback(null, data);
  });
}

/**
 * Read file using Promise (modern pattern)
 */
const readFileAsync = (filePath) => {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
};

/**
 * Write JSON data to file (async/await)
 */
async function writeJsonFile(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Compress audio data buffer (for storing recordings)
 * Uses zlib deflate
 */
function compressBuffer(buffer) {
  return new Promise((resolve, reject) => {
    zlib.deflate(buffer, (err, compressed) => {
      if (err) reject(err);
      else resolve(compressed);
    });
  });
}

/**
 * Decompress buffer
 */
function decompressBuffer(buffer) {
  return new Promise((resolve, reject) => {
    zlib.inflate(buffer, (err, decompressed) => {
      if (err) reject(err);
      else resolve(decompressed);
    });
  });
}

/**
 * Stream-based file stats reporter (Transform stream example)
 */
class StatsTransform extends Transform {
  constructor(options = {}) {
    super(options);
    this.bytesProcessed = 0;
    this.chunks = 0;
  }

  _transform(chunk, encoding, callback) {
    this.bytesProcessed += chunk.length;
    this.chunks++;
    this.push(chunk);
    callback();
  }

  _flush(callback) {
    logger.info(`Stream stats: ${this.chunks} chunks, ${this.bytesProcessed} bytes`);
    callback();
  }
}

module.exports = {
  compressFile,
  decompressFile,
  readFileCallback,
  readFileAsync,
  writeJsonFile,
  compressBuffer,
  decompressBuffer,
  StatsTransform,
};
