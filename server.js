// server.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const nodemailer = require('nodemailer'); // <--- AÑADIDO: Importa Nodemailer

const app = express();
const PORT = process.env.PORT || 3000; // Usa el puerto de Render o 3000 localmente
const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true'; // <--- Mantiene la variable de entorno para mantenimiento

app.use(cors());
app.use(bodyParser.json());

// <--- AÑADIDO: Configuración de Nodemailer
// Es CRÍTICO usar variables de entorno para las credenciales en producción.
// En Render, configuras estas variables en el dashboard (ej. EMAIL_USER, EMAIL_PASS)
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com', // Por ejemplo, 'smtp.gmail.com' para Gmail
    port: process.env.EMAIL_PORT || 587, // Puerto SMTP, 587 para TLS/STARTTLS
    secure: process.env.EMAIL_SECURE === 'true', // true para 465 (SSL), false para otros puertos (como 587 STARTTLS)
    auth: {
        user: process.env.EMAIL_USER, // Tu dirección de correo electrónico (ej. 'tu_correo@gmail.com')
        pass: process.env.EMAIL_PASS, // La contraseña de aplicación o específica del email
    },
    tls: {
        // Importante si tienes problemas con certificados en algunos entornos
        rejectUnauthorized: false
    }
});

// <--- AÑADIDO: Función para enviar el correo de bienvenida
async function sendWelcomeEmail(userName, userEmail) {
    const mailOptions = {
        from: process.env.EMAIL_FROM || '"Eva Vidal Nutrición" <info@evavidal.com>', // Dirección del remitente
        to: userEmail,
        subject: `¡Bienvenido/a, ${userName}! Acceso a tu Ebook de Nutrición y Bienestar 🌟`,
        html: `
            <div style="font-family: 'Inter', sans-serif; line-height: 1.6; color: #555555; max-width: 600px; margin: auto; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden;">
                <div style="background-color: #4A729E; padding: 25px; text-align: center; color: white;">
                    <h1 style="font-family: 'Poppins', sans-serif; font-size: 2.2em; margin: 0;">¡Hola, ${userName}!</h1>
                    <p style="font-size: 1.1em; margin: 5px 0 0;">Tu acceso al ebook ha sido confirmado.</p>
                </div>
                <div style="padding: 30px;">
                    <p>Muchas gracias por adquirir nuestro ebook exclusivo: <strong>"El Camino hacia el Bienestar Duradero: Nutrición y Ejercicio Consciente".</strong></p>
                    <p>Estamos emocionados de que formes parte de nuestra comunidad y esperamos que disfrutes y aproveches al máximo el contenido que hemos preparado para ti para transformar tu salud y bienestar.</p>
                    <p>Tu acceso ya ha sido validado con la licencia que proporcionaste. Puedes comenzar a explorar todo el material:</p>
                    <p style="text-align: center; margin: 30px 0;">
                        <a href="${process.env.FRONTEND_URL || 'http://localhost:5500/index.html'}" 
                           style="background-color: #7091B8; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 1.1em; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
                           Acceder a tu Ebook Aquí
                        </a>
                    </p>
                    <p>Si tienes alguna pregunta, necesitas asistencia técnica o deseas profundizar en algún tema de nutrición y bienestar, no dudes en contactarnos a través de WhatsApp. ¡Estamos aquí para ayudarte!</p>
                    <p style="text-align: center; margin-top: 30px;">
                        <a href="https://wa.me/34644137667" target="_blank" style="color: #25D366; text-decoration: none; font-weight: bold;">
                            <img src="https://img.icons8.com/color/48/000000/whatsapp--v1.png" alt="WhatsApp Icon" style="vertical-align: middle; margin-right: 8px;">
                            Contáctanos por WhatsApp
                        </a>
                    </p>
                </div>
                <div style="background-color: #f8f8f8; padding: 20px; text-align: center; font-size: 0.9em; color: #888888; border-top: 1px solid #e0e0e0;">
                    <p>&copy; ${new Date().getFullYear()} Eva Vidal Nutrición. Todos los derechos reservados.</p>
                    <p>Este correo es generado automáticamente, por favor no respondas a este mensaje.</p>
                </div>
            </div>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Correo de bienvenida enviado con éxito a: ${userEmail}`);
    } catch (error) {
        console.error(`Error al enviar correo de bienvenida a ${userEmail}:`, error);
        // Opcional: Podrías loggear el error en un servicio de logs o base de datos
    }
}

// Middleware para el modo de mantenimiento
app.use((req, res, next) => {
    if (MAINTENANCE_MODE && req.path !== '/') { // Permite el health check en '/' incluso en mantenimiento
        res.status(503).send('<h1>&#9888; Web en Mantenimiento &#9888;</h1><p>Estamos realizando actualizaciones importantes para mejorar tu experiencia. Disculpa las molestias, estaremos de vuelta pronto.</p>');
    } else {
        next();
    }
});

// Endpoint de Health Check
app.get('/', (req, res) => {
    res.status(200).send('Servidor de licencias activo y funcionando.');
});

// Endpoint para validar y registrar la licencia
app.post('/validate-and-register-license', async (req, res) => {
    const { userName, userEmail, license } = req.body;
    const clientIp = req.ip; // Express ya te da la IP del cliente

    if (!userName || !userEmail || !license) {
        return res.status(400).json({ valid: false, message: 'Faltan campos requeridos.' });
    }

    // Validación básica del formato del correo electrónico
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userEmail)) {
        return res.status(400).json({ valid: false, message: 'Formato de correo electrónico inválido.' });
    }

    console.log(`Intento de acceso: Nombre=${userName}, Email=${userEmail}, Licencia=${license}, IP=${clientIp}`);

    // Simulación de validación de licencia
    // **AQUÍ ES DONDE CONECTARÍAS CON TU BASE DE DATOS REAL PARA:
    // 1. Buscar la licencia.
    // 2. Verificar si es válida (no expirada, no falsa).
    // 3. Verificar si está ya usada (si es de un solo uso).
    // 4. Si es válida y no usada, marcarla como usada (o vincularla al email/IP).**

    const validLicenses = ['EVAV2024-LIC123', 'EVANUT-KEYABC', 'TEST-KEY']; // Licencias de ejemplo
    const usedLicenses = ['EVAV2024-LIC123']; // Licencias usadas (simulación de DB)

    let isValid = validLicenses.includes(license);
    let isUsed = usedLicenses.includes(license); // En un entorno real, esto sería una consulta a la DB

    if (isValid && !isUsed) {
        // En un entorno real:
        // - Marcar la licencia como usada en tu base de datos.
        // - Almacenar userName, userEmail y clientIp asociados a esta licencia.
        // - Podrías añadir un timestamp de uso.
        console.log(`Licencia '${license}' validada y marcada como usada para ${userEmail}.`);
        
        // <--- AÑADIDO: Envía el correo de bienvenida tras la validación exitosa
        await sendWelcomeEmail(userName, userEmail);

        return res.json({ valid: true, message: 'Licencia validada. Acceso concedido.' });
    } else if (isUsed) {
        console.warn(`Intento de uso de licencia ya utilizada: ${license} por ${userEmail}`);
        return res.status(403).json({ valid: false, message: 'Clave de licencia ya utilizada.' });
    } else {
        console.warn(`Intento de acceso con licencia inválida: ${license} por ${userEmail}`);
        return res.status(401).json({ valid: false, message: 'Clave de licencia inválida.' });
    }
});

// Endpoint para recolectar datos de usuario (ya existía)
app.post('/collect-user-data', (req, res) => {
    const { userName, userEmail, licenseKey, timestamp } = req.body;
    const clientIp = req.ip; // Express ya te da la IP del cliente
    
    console.log('Datos de usuario recibidos para almacenamiento:', { userName, userEmail, licenseKey, clientIp, timestamp });
    // Aquí puedes añadir tu lógica para almacenar estos datos en una base de datos,
    // un servicio de CRM, un archivo de logs, etc.
    // Asegúrate de manejar esto de forma asíncrona si es una operación de I/O pesada.

    res.status(200).send('Datos de usuario recibidos para procesamiento.');
});


// Manejo de errores 404
app.use((req, res) => {
    res.status(404).send('Página no encontrada.');
});

// Middleware de manejo de errores global
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Algo salió mal en el servidor.');
});

app.listen(PORT, () => {
    console.log(`Servidor de licencias escuchando en el puerto ${PORT}`);
    if (MAINTENANCE_MODE) {
        console.warn('¡ADVERTENCIA: EL SERVIDOR ESTÁ EN MODO DE MANTENIMIENTO!');
    }
});