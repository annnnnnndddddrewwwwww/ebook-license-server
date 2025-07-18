// server.js
require('dotenv').config(); // Carga las variables de entorno desde .env (solo para desarrollo local)
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const { google } = require('googleapis'); // Importa googleapis
const nodemailer = require('nodemailer');

const app = express();
const port = process.env.PORT || 3000;

// --- Global Uncaught Exception Handling ---
process.on('uncaughtException', (err) => {
    console.error('ERROR FATAL: Se ha detectado una excepción no capturada!');
    console.error(err);
    process.exit(1); // Exit with a failure code
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('ERROR FATAL: Se ha detectado una promesa rechazada no manejada!');
    console.error('Razón:', reason);
    console.error('Promesa:', promise);
    process.exit(1); // Exit with a failure code
});
// --- Fin del manejo de errores globales ---

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
const APP_CONFIG_SHEET_NAME = 'AppConfig'; // NUEVA: Nombre de la pestaña para configuración de la app
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

let sheets; // Variable global para el cliente de Google Sheets API

// Variable para el estado del modo de mantenimiento
// Inicialmente false, pero se cargará desde Google Sheets al iniciar el servidor
let maintenanceMode = false; 

// Función para autenticar con Google Sheets y cargar/establecer modo de mantenimiento
async function authenticateGoogleSheets() {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
                private_key: GOOGLE_PRIVATE_KEY,
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const authClient = await auth.getClient();
        googleSheets = google.sheets({ version: 'v4', auth: authClient });
        console.log('Autenticación con Google Sheets exitosa!');

        // Cargar o establecer el modo de mantenimiento
        await loadMaintenanceModeFromSheet();

    } catch (error) {
        console.error('ERROR CRÍTICO: Fallo en la autenticación o configuración inicial de Google Sheets:', error.message);
        console.error(error.stack); // Log the full stack trace
        process.exit(1); // Exit if critical Google Sheets setup fails
    }
}

// ... (Your loadMaintenanceModeFromSheet function)
async function loadMaintenanceModeFromSheet() {
    try {
        // ... (existing code for reading and setting maintenance mode)
    } catch (error) {
        console.error('ERROR AL CARGAR/ESTABLECER MODO DE MANTENIMIENTO:', error.message);
        console.error(error.stack); // Log the full stack trace
        process.exit(1); // Exit if this critical operation fails
    }
}

// Conectar a Google Sheets al iniciar el servidor
authenticateGoogleSheets();

// --- Middleware para obtener la IP del cliente ---
app.set('trust proxy', true); // Necesario para obtener la IP real detrás de un proxy (Render)

// --- Middleware para el modo de mantenimiento (¡DEBE IR ANTES DE TODAS LAS DEMÁS RUTAS!) ---
app.use((req, res, next) => {
    // Si la solicitud es para cambiar o verificar el estado de mantenimiento, déjala pasar
    if (req.path === '/set-maintenance-mode' || req.path === '/get-maintenance-status') {
        return next();
    }
    
    if (maintenanceMode) {
        return res.status(503).send(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Web en Mantenimiento</title>
                <style>
                    body {
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        text-align: center;
                        padding-top: 80px;
                        background-color: #f0f0f0;
                        color: #333;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                        margin: 0;
                    }
                    .container {
                        max-width: 700px;
                        background-color: #ffffff;
                        padding: 40px;
                        border-radius: 12px;
                        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
                        border: 2px solid #ffcc00;
                    }
                    .emoji-large {
                        font-size: 150px;
                        display: inline-block;
                        animation: spin 2s linear infinite;
                        margin-bottom: 20px;
                    }
                    .message {
                        font-size: 28px;
                        font-weight: bold;
                        color: #e65100; /* Naranja oscuro */
                        margin-bottom: 25px;
                    }
                    .warning-emoji {
                        font-size: 30px;
                        vertical-align: middle;
                        margin: 0 10px;
                    }
                    p {
                        font-size: 18px;
                        color: #555;
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="emoji-large">⚙️</div>
                    <div class="message">
                        <span class="warning-emoji">⚠️</span> ¡Web en Mantenimiento! <span class="warning-emoji">⚠️</span>
                    </div>
                    <p>Estamos realizando actualizaciones importantes para mejorar tu experiencia.</p>
                    <p>Disculpa las molestias, estaremos de vuelta pronto.</p>
                </div>
            </body>
            </html>
        `);
    }
    next(); // Continuar con las rutas normales si no está en mantenimiento
});


// --- Funciones de Utilidad para Google Sheets ---

// Lee todas las filas de una hoja y las convierte en un array de objetos
async function getSheetData(sheetName) {
    if (!sheets) throw new Error("Google Sheets API no inicializada.");
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetName}!A:Z`, // Lee hasta la columna Z para asegurar todos los datos
        });
        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return []; // No hay datos
        }

        const headers = rows[0]; // La primera fila son los encabezados
        const data = rows.slice(1).map(row => {
            let obj = {};
            headers.forEach((header, index) => {
                obj[header] = row[index] || ''; // Asigna valor o cadena vacía si es undefined
            });
            return obj;
        });
        return data;
    } catch (error) {
        console.error(`Error al leer datos de la hoja '${sheetName}':`, error);
        throw error;
    }
}

// Añade una nueva fila a la hoja
async function appendSheetRow(sheetName, rowData) {
    if (!sheets) throw new Error("Google Sheets API no inicializada.");
    try {
        const headers = await getSheetHeaders(sheetName); // Obtener encabezados dinámicamente
        const values = headers.map(header => rowData[header] || ''); // Mapear datos a los encabezados
        
        await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetName}!A1`, // Rango donde empezar a añadir (busca la primera fila vacía)
            valueInputOption: 'RAW',
            resource: {
                values: [values],
            },
        });
    } catch (error) {
        console.error(`Error al añadir fila a la hoja '${sheetName}':`, error);
        throw error;
    }
}

// Actualiza una fila existente en la hoja
async function updateSheetRow(sheetName, identifier, identifierValue, newRowData) {
    if (!sheets) throw new Error("Google Sheets API no inicializada.");
    try {
        const allRows = await getSheetData(sheetName); // Obtener todos los datos
        const headers = allRows.length > 0 ? Object.keys(allRows[0]) : await getSheetHeaders(sheetName); // Obtener headers si no hay filas

        const rowIndexToUpdate = allRows.findIndex(row => row[identifier] === identifierValue);
        
        if (rowIndexToUpdate === -1) {
            // Si no se encuentra, podemos optar por añadirla si es una actualización con 'upsert'
            console.warn(`No se encontró la fila con ${identifier}='${identifierValue}' para actualizar en ${sheetName}. Se intentará añadir.`);
            await appendSheetRow(sheetName, newRowData);
            return;
        }

        // Fila original del sheet, incluyendo los encabezados (rowIndexToUpdate + 1)
        const actualSheetRowIndex = rowIndexToUpdate + 2; // +1 por los encabezados, +1 por ser 1-indexed

        const existingRow = allRows[rowIndexToUpdate];
        const mergedRow = { ...existingRow, ...newRowData }; // Fusionar datos nuevos con existentes

        const values = headers.map(header => mergedRow[header] || '');

        await sheets.spreadsheets.values.update({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetName}!A${actualSheetRowIndex}`, // Rango de la fila específica a actualizar
            valueInputOption: 'RAW',
            resource: {
                values: [values],
            },
        });
    } catch (error) {
        console.error(`Error al actualizar fila en la hoja '${sheetName}':`, error);
        throw error;
    }
}

// Obtiene los encabezados de una hoja
async function getSheetHeaders(sheetName) {
    if (!sheets) throw new Error("Google Sheets API no inicializada.");
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetName}!1:1`, // Leer solo la primera fila
        });
        return response.data.values[0] || [];
    } catch (error) {
        console.error(`Error al obtener encabezados de la hoja '${sheetName}':`, error);
        throw error;
    }
}

// --- Funciones para manejar la configuración de la aplicación (modo de mantenimiento) ---

/**
 * Lee un valor de configuración de la hoja 'AppConfig'.
 * Asume que 'AppConfig' tiene columnas 'SettingName' y 'SettingValue'.
 * @param {string} key El nombre de la configuración a leer (ej. 'maintenanceMode').
 * @returns {Promise<string|undefined>} El valor de la configuración o undefined si no se encuentra.
 */
async function getAppConfigValue(key) {
    try {
        const configData = await getSheetData(APP_CONFIG_SHEET_NAME);
        const configEntry = configData.find(row => row.SettingName === key);
        return configEntry ? configEntry.SettingValue : undefined;
    } catch (error) {
        console.error(`Error al leer la configuración '${key}' de Google Sheets:`, error);
        return undefined; // Retornar undefined en caso de error
    }
}

/**
 * Guarda un valor de configuración en la hoja 'AppConfig'.
 * Asume que 'AppConfig' tiene columnas 'SettingName' y 'SettingValue'.
 * Si la configuración existe, la actualiza; si no, la añade.
 * @param {string} key El nombre de la configuración a guardar (ej. 'maintenanceMode').
 * @param {string} value El valor a guardar.
 */
async function setAppConfigValue(key, value) {
    try {
        // Asumimos que los encabezados son 'SettingName' y 'SettingValue' para la hoja AppConfig
        const newConfigData = { SettingName: key, SettingValue: value };
        await updateSheetRow(APP_CONFIG_SHEET_NAME, 'SettingName', key, newConfigData);
        console.log(`Configuración '${key}' guardada en Google Sheets: ${value}`);
    } catch (error) {
        console.error(`Error al guardar la configuración '${key}' en Google Sheets:`, error);
    }
}

/**
 * Carga el estado inicial de maintenanceMode desde Google Sheets.
 * Si no se encuentra, lo inicializa a 'false' y lo guarda.
 */
async function loadMaintenanceModeFromSheet() {
    try {
        let loadedValue = await getAppConfigValue('maintenanceMode');
        if (loadedValue === undefined) {
            // Si la configuración no existe, inicializarla a 'false' y guardarla
            await setAppConfigValue('maintenanceMode', 'false');
            maintenanceMode = false;
            console.log("Modo de mantenimiento inicializado a false en Google Sheets.");
        } else {
            maintenanceMode = (loadedValue === 'true'); // Convertir string a booleano
            console.log(`Modo de mantenimiento cargado desde Google Sheets: ${maintenanceMode}`);
        }
    } catch (error) {
        console.error("Error al cargar el modo de mantenimiento al iniciar el servidor:", error);
        maintenanceMode = false; // Fallback a false en caso de error grave
    }
}


// --- Endpoint para OBTENER TODAS las Licencias (para el generador) ---
app.get('/licenses', async (req, res) => {
    if (!sheets) return res.status(503).json({ message: "Servicio de Google Sheets no disponible." });
    try {
        const licenses = await getSheetData(LICENSES_SHEET_NAME);
        // Asegúrate de que activatedIps sea un array para el cliente
        licenses.forEach(lic => {
            lic.activatedIps = lic.activatedIps ? lic.activatedIps.split(',') : [];
            lic.isValid = lic.isValid === 'true'; // Convertir string 'true'/'false' a booleano
            lic.maxUniqueIps = parseInt(lic.maxUniqueIps, 10);
        });
        res.json(licenses);
    } catch (error) {
        res.status(500).json({ message: "Error interno del servidor al obtener licencias." });
    }
});

// --- Endpoint para OBTENER TODOS los Datos de Usuario (para el generador/admin) ---
app.get('/users', async (req, res) => {
    if (!sheets) return res.status(503).json({ message: "Servicio de Google Sheets no disponible." });
    try {
        const users = await getSheetData(USERS_SHEET_NAME);
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: "Error interno del servidor al obtener datos de usuarios." });
    }
});

// --- Endpoint para el Generador de Licencias ---
app.post('/generate-license', async (req, res) => {
    if (!sheets) return res.status(503).json({ success: false, message: "Servicio de Google Sheets no disponible." });
    
    const newLicenseKey = uuidv4(); 
    const maxUniqueIps = req.body.maxUniqueIps ? parseInt(req.body.maxUniqueIps, 10) : 1;

    if (isNaN(maxUniqueIps) || maxUniqueIps < 1) {
        return res.status(400).json({ success: false, message: "El límite de IPs únicas debe ser un número entero positivo." });
    }

    const licenseData = {
        licenseKey: newLicenseKey,
        maxUniqueIps: maxUniqueIps.toString(), // Guardar como string
        activatedIps: '',                      // Inicialmente vacío
        lastUsed: '',
        isValid: 'true',                       // Guardar como string 'true'
        createdAt: new Date().toISOString()
    };

    try {
        await appendSheetRow(LICENSES_SHEET_NAME, licenseData);
        console.log(`Licencia generada y añadida: ${newLicenseKey} (Máx IPs únicas: ${maxUniqueIps})`);
        res.status(201).json({ success: true, license: newLicenseKey, message: "Licencia generada con éxito." });
    } catch (error) {
        console.error("Error al generar licencia y guardar en Sheets:", error);
        res.status(500).json({ success: false, message: "Error interno del servidor al generar licencia." });
    }
});

// --- Endpoint para INVALIDAR una Licencia ---
app.post('/invalidate-license', async (req, res) => {
    if (!sheets) return res.status(503).json({ success: false, message: "Servicio de Google Sheets no disponible." });

    const { license: licenseKey } = req.body;

    if (!licenseKey) {
        return res.status(400).json({ success: false, message: "Clave de licencia no proporcionada para invalidar." });
    }

    try {
        const allLicenses = await getSheetData(LICENSES_SHEET_NAME);
        const licenseToUpdate = allLicenses.find(lic => lic.licenseKey === licenseKey);

        if (!licenseToUpdate) {
            return res.status(404).json({ success: false, message: "Licencia no encontrada." });
        }

        if (licenseToUpdate.isValid === 'false') {
            return res.status(200).json({ success: true, message: "La licencia ya estaba invalidada." });
        }

        // Actualiza el campo isValid
        const newLicenseData = { isValid: 'false' };
        await updateSheetRow(LICENSES_SHEET_NAME, 'licenseKey', licenseKey, newLicenseData);

        console.log(`Licencia '${licenseKey}' ha sido invalidada.`);
        res.json({ success: true, message: "Licencia invalidada con éxito." });
    } catch (error) {
        console.error("Error al invalidar licencia en Sheets:", error);
        res.status(500).json({ success: false, message: "Error interno del servidor al invalidar licencia." });
    }
});

// --- Endpoint para la Validación de Licencias ---
app.post('/validate-and-register-license', async (req, res) => {
    if (!sheets) return res.status(503).json({ valid: false, message: "Servicio de Google Sheets no disponible." });

    const { license: incomingLicenseKey, userName, userEmail } = req.body;
    const clientIp = req.ip;

    // AÑADIDO: Validación básica del formato del correo electrónico
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!userEmail || !emailRegex.test(userEmail)) { // Asegura que userEmail no esté vacío y tenga formato válido
        console.log(`Intento de validación con correo electrónico inválido o no proporcionado: '${userEmail}'. IP: ${clientIp}`);
        return res.status(400).json({ valid: false, message: "Correo electrónico inválido o no proporcionado." });
    }

    if (!incomingLicenseKey) {
        console.log(`Intento de validación sin clave. IP: ${clientIp}`);
        return res.status(400).json({ valid: false, message: "Clave de licencia no proporcionada." });
    }

    try {
        const allLicenses = await getSheetData(LICENSES_SHEET_NAME);
        let licenseData = allLicenses.find(lic => lic.licenseKey === incomingLicenseKey);

        if (!licenseData) {
            console.log(`Intento de validación con clave inexistente: '${incomingLicenseKey}'. IP: ${clientIp}`);
            return res.status(401).json({ valid: false, message: "Clave de licencia inválida o no activa." });
        }

        if (licenseData.isValid === 'false') { // Compara con el string 'false' de la hoja
            console.log(`Intento de validación con clave invalidada: '${incomingLicenseKey}'. IP: ${clientIp}`);
            return res.status(403).json({ valid: false, message: "Esta licencia ha sido invalidada y ya no es válida." });
        }

        // Convertir activatedIps a array para la lógica, y maxUniqueIps a número
        let activatedIpsArray = licenseData.activatedIps ? licenseData.activatedIps.split(',') : [];
        const maxUniqueIpsNum = parseInt(licenseData.maxUniqueIps, 10);

        const isIpAlreadyActivated = activatedIpsArray.includes(clientIp);

        if (isIpAlreadyActivated) {
            // Solo actualizamos el timestamp de último uso
            await updateSheetRow(LICENSES_SHEET_NAME, 'licenseKey', incomingLicenseKey, { lastUsed: new Date().toISOString() });
            console.log(`Licencia '${incomingLicenseKey}' re-validada por IP: ${clientIp}. IPs únicas usadas: ${activatedIpsArray.length}/${maxUniqueIpsNum}`);

            // AÑADIDO: Envía el correo de bienvenida al re-validar la licencia
            await sendWelcomeEmail(userName, userEmail); // <--- ¡AÑADE ESTA LÍNEA AQUÍ!

            res.json({ valid: true, message: "Licencia válida." });
        } else {
            if (activatedIpsArray.length < maxUniqueIpsNum) {
                activatedIpsArray.push(clientIp);
                const newActivatedIpsString = activatedIpsArray.join(',');
                // Añadir nueva IP y actualizar timestamp
                await updateSheetRow(LICENSES_SHEET_NAME, 'licenseKey', incomingLicenseKey, {
                    activatedIps: newActivatedIpsString,
                    lastUsed: new Date().toISOString()
                });
                console.log(`Licencia '${incomingLicenseKey}' activada por nueva IP: ${clientIp}. IPs únicas usadas: ${activatedIpsArray.length}/${maxUniqueIpsNum}`);

                // AÑADIDO: Envía el correo de bienvenida al activar la licencia por primera vez con una nueva IP
                await sendWelcomeEmail(userName, userEmail); // <--- ¡Y AÑADE ESTA LÍNEA AQUÍ!

                res.json({ valid: true, message: "Licencia válida y activada para esta IP." });
            } else {
                console.log(`Licencia '${incomingLicenseKey}' ha alcanzado su límite de ${maxUniqueIpsNum} IPs únicas. Intento de uso por IP: ${clientIp}`);
                res.status(403).json({ valid: false, message: `Esta licencia ya ha sido activada por su número máximo de ${maxUniqueIpsNum} IPs diferentes.` });
            }
        }
    } catch (error) {
        console.error("Error durante la validación/registro de licencia en Sheets:", error);
        res.status(500).json({ valid: false, message: "Error interno del servidor." });
    }
});

// --- ENDPOINT: Recopilar datos de usuario ---
app.post('/collect-user-data', async (req, res) => {
    // ... (Tu código existente para collect-user-data)
});

// --- NUEVO ENDPOINT: Establecer Modo de Mantenimiento ---
app.post('/set-maintenance-mode', async (req, res) => {
    // ... (Tu código existente para set-maintenance-mode)
});

// --- NUEVO ENDPOINT: Obtener Estado de Modo de Mantenimiento ---
app.get('/get-maintenance-status', (req, res) => {
    // ... (Tu código existente para get-maintenance-status)
});

// Ruta de bienvenida (opcional, para verificar que el servidor está corriendo)
app.get('/', (req, res) => {
    // ... (Tu código existente para la ruta raíz)
});

// Iniciar el servidor
app.listen(port, '0.0.0.0', () => { // <--- Added '0.0.0.0'
    console.log(`Servidor de licencias escuchando en http://0.0.0.0:${port}`); // Updated log for clarity
});