// server.js
require('dotenv').config(); // Carga las variables de entorno desde .env (solo para desarrollo local)
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const { google } = require('googleapis'); // Importa googleapis
const nodemailer = require('nodemailer'); // <--- Importa Nodemailer

const app = express();
const port = process.env.PORT || 3000;

// --- Configuración de CORS ---
app.use(cors({
    origin: '*', // Permite cualquier origen. PARA PRODUCCIÓN, REEMPLAZA CON TU DOMINIO REAL.
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// --- Configuración de Google Sheets ---
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID; // ID de tu hoja de cálculo
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'); // Reemplazar \\n por \n

const LICENSES_SHEET_NAME = 'Licenses'; // Nombre de la pestaña para licencias
const USERS_SHEET_NAME = 'Users';       // Nombre de la pestaña para usuarios
const APP_CONFIG_SHEET_NAME = 'AppConfig'; // Nombre de la pestaña para configuración de la app

let sheets; // Variable global para el cliente de Google Sheets
let maintenanceMode = false; // Estado inicial del modo de mantenimiento

// --- Configuración de Nodemailer (para el envío de correos) ---
// Configura un "transporter" SMTP. Puedes usar 'gmail' o especificar host, port, secure para otros SMTP
const transporter = nodemailer.createTransport({
    service: 'gmail', // Ejemplo: 'gmail'. Para otros servicios, busca su configuración SMTP.
    auth: {
        user: process.env.EMAIL_USER,    // Tu dirección de correo (ej. de Gmail)
        pass: process.env.EMAIL_PASS    // Tu contraseña de aplicación (para Gmail, no la contraseña de tu cuenta)
    }
});

// --- Función para enviar correo de bienvenida ---
async function sendWelcomeEmail(userName, userEmail, licenseKey) {
    try {
        const mailOptions = {
            from: process.env.EMAIL_USER, // Remitente
            to: userEmail,                // Destinatario
            subject: '¡Bienvenido a nuestro Ebook! Tu Licencia está lista 📚',
            html: `
                <p>Hola <strong>${userName}</strong>,</p>
                <p>¡Muchas gracias por adquirir tu licencia para nuestro Ebook!</p>
                <p>Tu clave de licencia es: <strong>${licenseKey}</strong></p>
                <p>Puedes acceder a tu Ebook en: <a href="TU_URL_DEL_EBOOK">TU_URL_DEL_EBOOK</a></p>
                <p>Esperamos que disfrutes de esta valiosa información.</p>
                <p>Saludos cordiales,</p>
                <p>El Equipo de [Tu Nombre/Empresa]</p>
                <hr>
                <small>Este es un correo automático, por favor no respondas a esta dirección.</small>
            `
        };

        await transporter.sendMail(mailOptions);
        console.log(`Correo de bienvenida enviado a ${userEmail}`);
    } catch (error) {
        console.error(`Error al enviar correo de bienvenida a ${userEmail}:`, error);
        throw error; // Propaga el error para que el endpoint pueda manejarlo
    }
}

// --- Función para inicializar Google Sheets ---
async function initGoogleSheets() {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
                private_key: GOOGLE_PRIVATE_KEY,
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const authClient = await auth.getClient();
        sheets = google.sheets({ version: 'v4', auth: authClient });

        // Cargar el modo de mantenimiento al inicio
        const maintenanceModeValue = await getAppConfigValue('maintenanceMode');
        maintenanceMode = maintenanceModeValue === 'true'; // Convierte a booleano
        console.log(`Modo de mantenimiento inicial: ${maintenanceMode}`);

        console.log('Google Sheets API inicializado con éxito.');
    } catch (error) {
        console.error('Error al inicializar Google Sheets API:', error);
        process.exit(1); // Sale de la aplicación si no se puede conectar a Google Sheets
    }
}

// --- Helper para obtener un valor de configuración ---
async function getAppConfigValue(key) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${APP_CONFIG_SHEET_NAME}!A:B`, // Asume clave en columna A, valor en columna B
        });
        const rows = response.data.values;
        if (rows) {
            const configRow = rows.find(row => row[0] === key);
            return configRow ? configRow[1] : null;
        }
        return null;
    } catch (error) {
        console.error(`Error al obtener valor de configuración para ${key}:`, error.message);
        return null;
    }
}

// --- Helper para establecer un valor de configuración ---
async function setAppConfigValue(key, value) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${APP_CONFIG_SHEET_NAME}!A:B`,
        });
        const rows = response.data.values;
        let rowToUpdate = -1;
        if (rows) {
            rowToUpdate = rows.findIndex(row => row[0] === key);
        }

        if (rowToUpdate !== -1) {
            // Actualizar fila existente
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `${APP_CONFIG_SHEET_NAME}!B${rowToUpdate + 1}`, // +1 porque los índices de la hoja son base 1
                valueInputOption: 'RAW',
                resource: {
                    values: [[value]],
                },
            });
        } else {
            // Añadir nueva fila
            await sheets.spreadsheets.values.append({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `${APP_CONFIG_SHEET_NAME}!A:B`,
                valueInputOption: 'RAW',
                resource: {
                    values: [[key, value]],
                },
            });
        }
        console.log(`Configuración '${key}' actualizada a '${value}'.`);
    } catch (error) {
        console.error(`Error al establecer valor de configuración para ${key}:`, error.message);
    }
}


// --- Endpoint para generar una licencia ---
// NOTA: Este endpoint ya NO envía el correo de bienvenida. Solo genera la licencia y registra al usuario.
app.post('/generate-license', async (req, res) => {
    if (maintenanceMode) {
        return res.status(503).json({ success: false, message: 'El servidor está en modo de mantenimiento. Inténtalo de nuevo más tarde.' });
    }

    const { userName, userEmail } = req.body;

    if (!userName || !userEmail) {
        return res.status(400).json({ success: false, message: 'Se requieren nombre de usuario y correo electrónico.' });
    }

    // Validación de formato de correo electrónico simple
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userEmail)) {
        return res.status(400).json({ success: false, message: 'Formato de correo electrónico inválido.' });
    }

    try {
        // Verificar si el correo ya existe en la hoja de usuarios
        const userCheckResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${USERS_SHEET_NAME}!B:B`, // Columna B para email
        });
        const existingUsers = userCheckResponse.data.values;
        if (existingUsers && existingUsers.some(row => row[0] === userEmail)) {
            return res.status(409).json({ success: false, message: 'Este correo electrónico ya tiene una licencia asociada.' });
        }

        // Generar una nueva licencia
        const licenseKey = uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase(); // Licencia de 16 caracteres alfanuméricos

        const now = new Date();
        const timestamp = now.toISOString(); // Formato ISO 8601
        const expiryDate = new Date(now.setFullYear(now.getFullYear() + 1)).toISOString(); // Válida por 1 año

        // Guardar en la pestaña 'Licenses'
        await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${LICENSES_SHEET_NAME}!A:E`,
            valueInputOption: 'RAW',
            resource: {
                values: [[licenseKey, userName, userEmail, timestamp, expiryDate]]
            }
        });

        // Guardar en la pestaña 'Users' - AHORA CON 'false' PARA welcomeEmailSent
        // Asegúrate de que tu hoja "Users" tenga una cuarta columna (D) para este valor.
        await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${USERS_SHEET_NAME}!A:D`, // A:D para incluir la nueva columna
            valueInputOption: 'RAW',
            resource: {
                values: [[userName, userEmail, timestamp, 'false']] // 'false' indica que el correo no ha sido enviado
            }
        });

        console.log(`Licencia generada y registrada: ${licenseKey} para ${userEmail}. Correo de bienvenida pendiente.`);

        res.json({ success: true, message: 'Licencia generada y registrada con éxito. Por favor, inicia sesión para acceder.', licenseKey: licenseKey });

    } catch (error) {
        console.error('Error al generar o registrar la licencia:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al generar la licencia.' });
    }
});


// --- Endpoint para validar y registrar una licencia ---
// NOTA: Este endpoint solo valida la licencia y devuelve la información del usuario.
// No registra nuevos usuarios (eso lo hace /generate-license) y no envía el correo de bienvenida.
app.post('/validate-and-register-license', async (req, res) => {
    if (maintenanceMode) {
        return res.status(503).json({ success: false, message: 'El servidor está en modo de mantenimiento. Inténtalo de nuevo más tarde.' });
    }

    const { licenseKey, userName, userEmail } = req.body;

    if (!licenseKey || !userName || !userEmail) {
        return res.status(400).json({ success: false, message: 'Se requieren clave de licencia, nombre de usuario y correo electrónico.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userEmail)) {
        return res.status(400).json({ success: false, message: 'Formato de correo electrónico inválido.' });
    }

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${LICENSES_SHEET_NAME}!A:E`, // Obtener todas las columnas relevantes
        });

        const licenses = response.data.values;
        let licenseFound = false;
        let isValid = false;
        let currentUserName = '';
        let currentUserEmail = '';
        let associatedLicenseKey = ''; // Variable para guardar la clave de licencia asociada

        if (licenses) {
            for (const row of licenses) {
                const [storedLicenseKey, storedUserName, storedUserEmail, storedTimestamp, storedExpiryDate] = row;

                if (storedLicenseKey === licenseKey.toUpperCase()) {
                    licenseFound = true;
                    // Verificar si la licencia ha expirado
                    const expiryDate = new Date(storedExpiryDate);
                    if (expiryDate > new Date()) {
                        isValid = true;
                        currentUserName = storedUserName;
                        currentUserEmail = storedUserEmail;
                        associatedLicenseKey = storedLicenseKey; // Guarda la clave de licencia
                    }
                    break;
                }
            }
        }

        if (licenseFound && isValid) {
            // Licencia válida: devuelve los datos del usuario asociado a esa licencia
            res.json({ success: true, message: 'Licencia válida. Acceso concedido.', userName: currentUserName, userEmail: currentUserEmail, licenseKey: associatedLicenseKey });
        } else if (licenseFound && !isValid) {
            res.status(403).json({ success: false, message: 'La licencia ha expirado. Por favor, contacta al soporte.' });
        } else {
            res.status(404).json({ success: false, message: 'Licencia no encontrada o inválida.' });
        }

    } catch (error) {
        console.error('Error al validar la licencia:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al validar la licencia.' });
    }
});


// --- NUEVO ENDPOINT: Para enviar correo de bienvenida al inicio de sesión ---
// Este endpoint se llama desde el frontend DESPUÉS de una validación exitosa de licencia.
// Envía el correo SÓLO UNA VEZ por usuario.
app.post('/send-welcome-on-login', async (req, res) => {
    const { userEmail, userName, licenseKey } = req.body;

    if (!userEmail || !userName || !licenseKey) {
        return res.status(400).json({ success: false, message: 'Se requieren correo, nombre de usuario y clave de licencia.' });
    }

    try {
        // 1. Buscar al usuario en la hoja 'Users' para verificar si el correo ya fue enviado
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${USERS_SHEET_NAME}!A:D`, // Ahora A:D para leer 'welcomeEmailSent'
        });

        let users = response.data.values;
        let userRowIndex = -1;
        let welcomeEmailSent = 'false'; // Valor por defecto si la columna no existe o está vacía

        if (users && users.length > 0) {
            // La primera fila son los encabezados, los datos de usuario empiezan desde la fila 2 (índice 1 en array)
            for (let i = 0; i < users.length; i++) {
                // Compara el email (columna B, índice 1)
                if (users[i][1] === userEmail) {
                    // +1 porque la hoja es base 1
                    userRowIndex = i + 1; // Guarda el número de fila en la hoja de Google Sheets
                    // welcomeEmailSent está en la columna D (índice 3)
                    welcomeEmailSent = users[i][3] || 'false'; // Si la columna está vacía, asume 'false'
                    break;
                }
            }
        }

        if (userRowIndex === -1) {
            // Esto no debería ocurrir si /generate-license siempre registra usuarios.
            // Si el usuario no se encuentra, no se puede enviar el correo (o se podría añadir y enviar, pero el flujo es que ya existe).
            console.warn(`Intento de enviar correo de bienvenida a usuario no registrado en hoja de Users: ${userEmail}`);
            return res.status(404).json({ success: false, message: 'Usuario no encontrado en la base de datos de usuarios.' });
        }

        if (welcomeEmailSent === 'true') {
            console.log(`Correo de bienvenida ya enviado a ${userEmail}. No se reenvía.`);
            return res.json({ success: true, message: 'Correo de bienvenida ya enviado.' });
        } else {
            // El correo no ha sido enviado, procede a enviarlo
            await sendWelcomeEmail(userName, userEmail, licenseKey);

            // Actualiza el estado en Google Sheets a 'true' para este usuario
            // userRowIndex ya es el número de fila real en la hoja (base 1)
            const rangeToUpdate = `${USERS_SHEET_NAME}!D${userRowIndex}`; // Columna D, fila de userRowIndex
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: rangeToUpdate,
                valueInputOption: 'RAW',
                resource: {
                    values: [['true']],
                },
            });
            console.log(`Estado de envío de correo de bienvenida actualizado a 'true' para ${userEmail}`);

            return res.json({ success: true, message: 'Correo de bienvenida enviado con éxito.' });
        }

    } catch (error) {
        console.error('Error al manejar el envío de correo en inicio de sesión:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al enviar el correo de bienvenida.' });
    }
});


// --- Endpoint para obtener todas las licencias (solo para administración) ---
app.get('/licenses', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${LICENSES_SHEET_NAME}!A:E`,
        });
        const licenses = response.data.values;
        if (licenses && licenses.length > 0) {
            // Eliminar la primera fila (encabezados) si está presente
            const headers = licenses[0];
            const data = licenses.slice(1);
            res.json({ success: true, licenses: data.map(row => ({
                licenseKey: row[0],
                userName: row[1],
                userEmail: row[2],
                generatedAt: row[3],
                expiresAt: row[4]
            })) });
        } else {
            res.json({ success: true, licenses: [], message: 'No hay licencias registradas.' });
        }
    } catch (error) {
        console.error('Error al obtener licencias:', error.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor al obtener licencias.' });
    }
});

// --- Endpoint para obtener todos los usuarios (solo para administración) ---
// Ahora incluye la columna 'welcomeEmailSent'
app.get('/users', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${USERS_SHEET_NAME}!A:D`, // Ahora A:D para leer 'welcomeEmailSent'
        });
        const users = response.data.values;
        if (users && users.length > 0) {
            // Eliminar la primera fila (encabezados) si está presente
            const headers = users[0];
            const data = users.slice(1);
            res.json({ success: true, users: data.map(row => ({
                userName: row[0],
                userEmail: row[1],
                registeredAt: row[2],
                welcomeEmailSent: row[3] || 'false' // Asegurarse de que exista el valor, por si la columna está vacía
            })) });
        } else {
            res.json({ success: true, users: [], message: 'No hay usuarios registrados.' });
        }
    } catch (error) {
        console.error('Error al obtener usuarios:', error.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor al obtener usuarios.' });
    }
});

// --- Endpoint para establecer el modo de mantenimiento ---
app.post('/set-maintenance-mode', async (req, res) => {
    const { maintenanceMode: newState } = req.body;
    if (typeof newState === 'boolean') {
        maintenanceMode = newState;
        await setAppConfigValue('maintenanceMode', newState.toString());
        console.log(`Modo de mantenimiento cambiado a: ${maintenanceMode}`);
        res.json({ success: true, message: `Modo de mantenimiento establecido a ${newState}` });
    } else {
        res.status(400).json({ success: false, message: "Parámetro 'maintenanceMode' inválido. Debe ser true o false." });
    }
});

// --- Endpoint para obtener el estado del modo de mantenimiento ---
app.get('/get-maintenance-status', (req, res) => {
    res.json({ maintenanceMode: maintenanceMode });
});


// Ruta de bienvenida (opcional, para verificar que el servidor está corriendo)
app.get('/', (req, res) => {
    res.send('Servidor de licencias de Ebook funcionando con Google Sheets. Usa /generate-license para generar, /validate-and-register-license para validar, /licenses para ver todas las licencias y /users para ver los datos de usuario.');
});

// Iniciar el servidor después de inicializar Google Sheets
initGoogleSheets().then(() => {
    app.listen(port, () => {
        console.log(`Servidor de licencias escuchando en http://localhost:${port}`);
    });
}).catch(error => {
    console.error('Fallo al iniciar el servidor debido a error de inicialización de Google Sheets:', error);
});