const nodemailer = require('nodemailer');
const dotenv = require('dotenv');

dotenv.config(); // Loads .env from current dir

const testEmail = async () => {
  console.log('Testing SMTP connection...');
  console.log('Host:', process.env.SMTP_HOST);
  console.log('Port:', process.env.SMTP_PORT);
  console.log('User:', process.env.SMTP_USER);

  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS ? process.env.SMTP_PASS.trim() : '',
    },
  });

  try {
    const verified = await transporter.verify();
    console.log('SMTP connection verified successfully!', verified);
  } catch (err) {
    console.error('SMTP connection failed:', err.message);
  }
};

testEmail();
