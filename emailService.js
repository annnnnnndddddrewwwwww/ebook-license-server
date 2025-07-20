// emailService.js
const nodemailer = require('nodemailer');

// Load environment variables (ensure .env is configured)
const EMAIL_SERVICE = process.env.EMAIL_SERVICE;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const WELCOME_EMAIL_SUBJECT = process.env.WELCOME_EMAIL_SUBJECT || 'Welcome!';
const WELCOME_EMAIL_BODY = process.env.WELCOME_EMAIL_BODY || 'Thank you for registering.';

let transporter;

async function initializeEmailTransporter() {
    if (transporter) {
        return transporter; // Already initialized
    }

    // Configure Nodemailer transporter based on EMAIL_SERVICE
    if (EMAIL_SERVICE === 'gmail') {
        transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: EMAIL_USER,
                pass: EMAIL_PASS,
            },
        });
    } else if (EMAIL_SERVICE === 'SMTP') {
        // Example for a generic SMTP server (adjust host, port, security as needed)
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || 587, 10),
            secure: process.env.SMTP_SECURE === 'true', // Use 'true' for SSL/TLS
            auth: {
                user: EMAIL_USER,
                pass: EMAIL_PASS,
            },
        });
    } else {
        console.error("EMAIL_SERVICE not configured or not supported.");
        throw new Error("Email service not configured.");
    }

    // Verify connection configuration
    try {
        await transporter.verify();
        console.log('Email transporter is ready to send messages.');
    } catch (error) {
        console.error('Error verifying email transporter configuration:', error.message);
        throw error;
    }
    return transporter;
}

/**
 * Sends a welcome email to the user.
 * @param {string} toEmail - The recipient's email address.
 * @param {string} userName - The name of the user.
 * @param {string} licenseKey - The generated license key.
 */
async function sendWelcomeEmail(toEmail, userName, licenseKey) {
    try {
        const emailTransporter = await initializeEmailTransporter();

        // Personalize the email body
        let personalizedBody = WELCOME_EMAIL_BODY
            .replace('[userName]', userName || 'there')
            .replace('[licenseKey]', licenseKey);

        const mailOptions = {
            from: EMAIL_USER,
            to: toEmail,
            subject: WELCOME_EMAIL_SUBJECT,
            html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                    <h2 style="color: #0056b3;">¡Hola ${userName || 'Usuario'}! 👋</h2>
                    <p>Gracias por registrarte en nuestro servicio.</p>
                    <p>Tu clave de licencia es: <strong>${licenseKey}</strong></p>
                    <p>Guarda esta clave en un lugar seguro. La necesitarás para activar tu producto.</p>
                    <p>Si tienes alguna pregunta, no dudes en contactarnos.</p>
                    <p>Atentamente,<br>El equipo de Ebook Licenses</p>
                    <p style="font-size: 0.8em; color: #777;">Este es un correo electrónico automático, por favor no respondas a este mensaje.</p>
                </div>
            `,
        };

        const info = await emailTransporter.sendMail(mailOptions);
        console.log('Welcome email sent successfully:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error(`Error sending welcome email to ${toEmail}:`, error.message);
        return { success: false, error: error.message };
    }
}

module.exports = {
    sendWelcomeEmail,
    initializeEmailTransporter
};