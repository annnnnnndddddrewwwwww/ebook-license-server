// server.js
require('dotenv').config(); // Carga las variables de entorno desde .env (solo para desarrollo local)

// --- Manejador de Errores Globales ---
// Estas líneas deben ir al principio del archivo para capturar errores no manejados
// que podrían hacer que el proceso de Node.js se cierre inesperadamente.
process.on('uncaughtException', (err) => {
    console.error('ERROR FATAL: Se ha detectado una excepción no capturada!');
    console.error(err);
    process.exit(1); // Sale del proceso con un código de error
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('ERROR FATAL: Se ha detectado una promesa rechazada no manejada!');
    console.error('Razón:', reason);
    console.error('Promesa:', promise);
    process.exit(1); // Sale del proceso con un código de error
});
// --- Fin del manejo de errores globales ---

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const { google } = require('googleapis'); // Importa googleapis
const nodemailer = require('nodemailer');
const path = require('path'); // ¡Importado para servir archivos estáticos!

const app = express();
const port = process.env.PORT || 3000;

// --- Configuración de CORS ---
app.use(cors({
    origin: '*', // Permite cualquier origen. PARA PRODUCCIÓN, REEMPLAZA CON TU DOMINIO REAL.
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json()); // Middleware para parsear bodies JSON

// --- Configuración para servir archivos estáticos (Frontend) ---
// Sirve archivos HTML, CSS, JavaScript del frontend desde la carpeta 'public'.
// Asegúrate de que tu 'index.html' y otros archivos estén dentro de la carpeta 'public'.
app.use(express.static(path.join(__dirname, 'public')));
// --- Fin de adición ---

// --- Configuración de Google Sheets ---
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID; // ID de tu hoja de cálculo
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
// Importante: Asegúrate de que GOOGLE_PRIVATE_KEY se copie correctamente en Render.
// El .replace(/\\n/g, '\n') es para manejar los saltos de línea en la clave privada.
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';

// Variable global para la instancia de Google Sheets API
let googleSheets; // Se inicializará en authenticateGoogleSheets()

const LICENSES_SHEET_NAME = 'Licenses'; // Nombre de la pestaña para licencias
const USERS_SHEET_NAME = 'Users';       // Nombre de la pestaña para usuarios
const APP_CONFIG_SHEET_NAME = 'AppConfig'; // NUEVA: Nombre de la pestaña para configuración de la app

// --- Configuración de Nodemailer ---
const transporter = nodemailer.createTransport({
    service: 'gmail', // Usa 'gmail' para una configuración más sencilla si usas Gmail
    auth: {
        user: process.env.EMAIL_USER, // Tu dirección de correo electrónico
        pass: process.env.EMAIL_PASS  // Tu contraseña de aplicación (para Gmail) o contraseña normal
    }
});

// Función para enviar correo de bienvenida (Reincorporada y Mejorada)
async function sendWelcomeEmail(userName, userEmail, licenseKey) {
    const mailOptions = {
        from: process.env.EMAIL_FROM || '"Tu Empresa" <no-reply@tudominio.com>', // Dirección del remitente
        to: userEmail,
        subject: `¡Bienvenido/a, ${userName}! Acceso a tu Ebook Confirmado 🌟`,
        html: `
            <div style="font-family: 'Inter', sans-serif; line-height: 1.6; color: #555555; max-width: 600px; margin: auto; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden;">
                <div style="background-color: #4A729E; padding: 25px; text-align: center; color: white;">
                    <h1 style="font-family: 'Poppins', sans-serif; font-size: 2.2em; margin: 0;">¡Hola, ${userName}!</h1>
                    <p style="font-size: 1.1em; margin: 5px 0 0;">Tu acceso al ebook ha sido confirmado.</p>
                </div>
                <div style="padding: 30px;">
                    <p>Muchas gracias por adquirir nuestro ebook exclusivo.</p>
                    <p>Tu acceso ya ha sido validado con la licencia que proporcionaste: <strong>${licenseKey}</strong>.</p>
                    <p>Puedes comenzar a explorar todo el material:</p>
                    <p style="text-align: center; margin: 30px 0;">
                        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}" 
                           style="background-color: #7091B8; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 1.1em; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
                           Acceder a tu Ebook Aquí
                        </a>
                    </p>
                    <p>Si tienes alguna pregunta, no dudes en contactarnos.</p>
                </div>
                <div style="background-color: #f8f8f8; padding: 20px; text-align: center; font-size: 0.9em; color: #888888; border-top: 1px solid #e0e0e0;">
                    <p>&copy; ${new Date().getFullYear()} Tu Empresa. Todos los derechos reservados.</p>
                    <p>Este correo es generado automáticamente, por favor no respondas a este mensaje.</p>
                </div>
            </div>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Correo de bienvenida enviado con éxito a: ${userEmail} para licencia ${licenseKey}`);
    } catch (error) {
        console.error(`Error al enviar correo de bienvenida a ${userEmail} para licencia ${licenseKey}:`, error);
        // Opcional: Podrías loggear el error en un servicio de logs o base de datos
    }
}


// Variable para el modo de mantenimiento
let maintenanceMode = false; // Inicializado a false por defecto

// --- FUNCIONES DE ASISTENCIA PARA GOOGLE SHEETS (MEJORADAS) ---

// Obtiene los encabezados de una hoja
async function getSheetHeaders(sheetName) {
    if (!googleSheets) throw new Error("Google Sheets API no inicializada. (getSheetHeaders)");
    try {
        const response = await googleSheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetName}!1:1`, // Leer solo la primera fila
        });
        return response.data.values ? response.data.values[0] : [];
    } catch (error) {
        console.error(`Error al obtener encabezados de la hoja '${sheetName}':`, error.message);
        throw error;
    }
}

// Lee todas las filas de una hoja y las convierte en un array de objetos (MEJORADO)
async function getSheetData(sheetName) {
    if (!googleSheets) throw new Error("Google Sheets API no inicializada. (getSheetData)");
    try {
        const response = await googleSheets.spreadsheets.values.get({
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
        console.error(`Error al leer datos de la hoja '${sheetName}':`, error.message);
        throw error;
    }
}

// Añade una nueva fila a la hoja usando un objeto de datos (MEJORADO)
async function appendSheetRow(sheetName, rowDataObject) {
    if (!googleSheets) throw new Error("Google Sheets API no inicializada. (appendSheetRow)");
    try {
        const headers = await getSheetHeaders(sheetName); // Obtener encabezados dinámicamente
        const values = headers.map(header => rowDataObject[header] || ''); // Mapear datos a los encabezados
        
        await googleSheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetName}!A1`, // Rango donde empezar a añadir (busca la primera fila vacía)
            valueInputOption: 'RAW', // Usa RAW para mantener formatos
            resource: {
                values: [values],
            },
        });
    } catch (error) {
        console.error(`Error al añadir fila a la hoja '${sheetName}':`, error.message);
        throw error;
    }
}

// Actualiza una fila existente en la hoja usando un objeto de datos (MEJORADO)
async function updateSheetRow(sheetName, identifierColumn, identifierValue, newRowDataObject) {
    if (!googleSheets) throw new Error("Google Sheets API no inicializada. (updateSheetRow)");
    try {
        const allRows = await getSheetData(sheetName); // Obtener todos los datos como objetos
        const headers = allRows.length > 0 ? Object.keys(allRows[0]) : await getSheetHeaders(sheetName); // Obtener headers

        const rowIndexToUpdate = allRows.findIndex(row => row[identifierColumn] === identifierValue);
        
        if (rowIndexToUpdate === -1) {
            console.warn(`No se encontró la fila con ${identifierColumn}='${identifierValue}' para actualizar en ${sheetName}. Se intentará añadir.`);
            await appendSheetRow(sheetName, newRowDataObject);
            return;
        }

        // Fila real en la hoja de Sheets (rowIndexToUpdate es 0-indexed para el array de datos, +2 para 1-indexed de Sheets y saltar encabezados)
        const actualSheetRowIndex = rowIndexToUpdate + 2; 

        const existingRow = allRows[rowIndexToUpdate];
        const mergedRow = { ...existingRow, ...newRowDataObject }; // Fusionar datos nuevos con existentes

        const values = headers.map(header => mergedRow[header] || ''); // Mapear el objeto fusionado a un array para Sheets

        await googleSheets.spreadsheets.values.update({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetName}!A${actualSheetRowIndex}`, // Rango de la fila específica a actualizar
            valueInputOption: 'RAW',
            resource: {
                values: [values],
            },
        });
    } catch (error) {
        console.error(`Error al actualizar fila en la hoja '${sheetName}':`, error.message);
        throw error;
    }
}


// --- FUNCIONES DE CONFIGURACIÓN DE LA APP (desde AppConfig sheet) ---

/**
 * Lee un valor de configuración de la hoja 'AppConfig'.
 * @param {string} key El nombre de la configuración a leer (ej. 'maintenanceMode').
 * @returns {Promise<string|undefined>} El valor de la configuración o undefined si no se encuentra.
 */
async function getAppConfigValue(key) {
    try {
        const configData = await getSheetData(APP_CONFIG_SHEET_NAME); // Obtiene objetos
        const configEntry = configData.find(row => row.SettingName === key);
        return configEntry ? configEntry.SettingValue : undefined;
    } catch (error) {
        console.error(`Error al leer la configuración '${key}' de Google Sheets:`, error.message);
        throw error; // Propagar el error
    }
}

/**
 * Guarda un valor de configuración en la hoja 'AppConfig'.
 * Si la configuración existe, la actualiza; si no, la añade.
 * @param {string} key El nombre de la configuración a guardar (ej. 'maintenanceMode').
 * @param {string} value El valor a guardar.
 */
async function setAppConfigValue(key, value) {
    try {
        const newConfigData = { 
            SettingName: key, 
            SettingValue: value, 
            LastUpdated: new Date().toISOString() 
        };
        // updateSheetRow maneja si la fila existe o no
        await updateSheetRow(APP_CONFIG_SHEET_NAME, 'SettingName', key, newConfigData);
        console.log(`Configuración '${key}' guardada en Google Sheets: ${value}`);
    } catch (error) {
        console.error(`Error al guardar la configuración '${key}' en Google Sheets:`, error.message);
        throw error; // Propagar el error
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
        console.error("Error al cargar el modo de mantenimiento al iniciar el servidor:", error.message);
        throw error; // Propagar el error
    }
}


// --- Función para autenticar con Google Sheets y cargar/establecer modo de mantenimiento ---
async function authenticateGoogleSheets() {
    // Asegúrate de que las credenciales existan
    if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
        throw new Error('Variables de entorno de Google Sheets no configuradas. Necesitas GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY.');
    }

    try {
        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
                private_key: GOOGLE_PRIVATE_KEY,
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const authClient = await auth.getClient();
        googleSheets = google.sheets({ version: 'v4', auth: authClient }); // Asigna la instancia a la variable global
        console.log('Autenticación con Google Sheets exitosa!');

        // Cargar o establecer el modo de mantenimiento después de la autenticación
        await loadMaintenanceModeFromSheet();

    } catch (error) {
        console.error('ERROR CRÍTICO: Fallo en la autenticación o configuración inicial de Google Sheets:', error.message);
        console.error(error.stack); // Log del stack trace
        throw error; // Propagar el error para que startServer lo capture
    }
}

// --- MIDDLEWARE ---
// Middleware para obtener la IP del cliente (CRÍTICO para Render)
app.set('trust proxy', true); // Necesario para obtener la IP real detrás de un proxy (Render)

// Middleware para el modo de mantenimiento (¡DEBE IR ANTES DE TODAS LAS DEMÁS RUTAS!)
app.use((req, res, next) => {
    // Excluye las rutas de verificación de estado o configuración de mantenimiento, y la ruta raíz
    if (req.path === '/get-maintenance-status' || req.path === '/set-maintenance-mode' || req.path === '/') {
        return next();
    }

    if (maintenanceMode) {
        console.log('Servidor en modo de mantenimiento. Solicitud a:', req.path);
        // Puedes servir una página HTML de mantenimiento aquí
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
    next();
});

// --- ENDPOINT: Validar y Registrar Licencia (UNIFICADO Y MEJORADO) ---
// Este endpoint debe manejar toda la lógica de validación, registro de IP y envío de email.
app.post('/validate-and-register-license', async (req, res) => {
    // Asegurarse de que googleSheets esté inicializado
    if (!googleSheets) {
        return res.status(503).json({ valid: false, message: "Servicio de licencias no disponible temporalmente." });
    }

    // Extraer todos los campos necesarios del body
    const { licenseKey, userName, userEmail } = req.body;
    const clientIp = req.ip; // O req.headers['x-forwarded-for'] si quieres la IP original del cliente detrás de un proxy

    // 1. Validaciones iniciales
    if (!licenseKey) {
        return res.status(400).json({ valid: false, message: "La clave de licencia es requerida." });
    }
    // Validación del formato del correo electrónico
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!userEmail || !emailRegex.test(userEmail)) {
        console.log(`Intento de validación con correo electrónico inválido o no proporcionado: '${userEmail}'. IP: ${clientIp}`);
        return res.status(400).json({ valid: false, message: "Correo electrónico inválido o no proporcionado." });
    }
    if (!userName) {
        return res.status(400).json({ valid: false, message: "El nombre de usuario es requerido." });
    }

    try {
        const licenses = await getSheetData(LICENSES_SHEET_NAME); // Obtiene licencias como objetos
        if (!licenses || licenses.length === 0) {
            console.warn("La hoja de licencias está vacía o no existe.");
            return res.status(500).json({ valid: false, message: "No se encontraron licencias en el sistema." });
        }

        let licenseFoundEntry = licenses.find(lic => lic.LicenseKey === licenseKey);

        if (!licenseFoundEntry) {
            console.log(`Licencia no encontrada: ${licenseKey}`);
            return res.status(404).json({ valid: false, message: "Licencia no válida o no encontrada." });
        }

        const isActivated = licenseFoundEntry.Activated === 'TRUE';
        const maxUniqueIpsNum = parseInt(licenseFoundEntry.MaxUniqueIPs || '1', 10);
        let uniqueIps = (licenseFoundEntry.UniqueIPs || '').split(',').filter(ip => ip.trim() !== '');

        let needsUpdate = false;
        let message = "";

        // Caso 1: La IP ya está registrada para esta licencia
        if (uniqueIps.includes(clientIp)) {
            message = "Licencia válida y ya activada para esta IP.";
            console.log(`Licencia '${licenseKey}' ya activada para IP: ${clientIp}`);
        } 
        // Caso 2: La IP es nueva y hay espacio para registrarla
        else if (uniqueIps.length < maxUniqueIpsNum) {
            uniqueIps.push(clientIp);
            licenseFoundEntry.UniqueIPs = uniqueIps.join(',');
            
            if (!isActivated) {
                licenseFoundEntry.Activated = 'TRUE'; // Activar si es la primera IP
            }
            needsUpdate = true;
            message = "Licencia válida y activada para esta nueva IP.";
            console.log(`Licencia '${licenseKey}' activada para nueva IP: ${clientIp}. IPs registradas: ${uniqueIps.length}/${maxUniqueIpsNum}`);
        } 
        // Caso 3: La IP es nueva, pero se ha alcanzado el límite máximo de IPs
        else {
            console.log(`Licencia '${licenseKey}' ha alcanzado su límite de ${maxUniqueIpsNum} IPs únicas. Intento de uso por IP: ${clientIp}`);
            return res.status(403).json({ valid: false, message: `Esta licencia ya ha sido activada por su número máximo de ${maxUniqueIpsNum} IPs diferentes.` });
        }

        // Si se necesita actualizar la hoja (nueva IP o primera activación)
        if (needsUpdate) {
            await updateSheetRow(LICENSES_SHEET_NAME, 'LicenseKey', licenseKey, licenseFoundEntry);
        }

        // Enviar email de bienvenida (se envía siempre que la validación es exitosa)
        await sendWelcomeEmail(userName, userEmail, licenseKey);

        return res.json({ valid: true, message: message });

    } catch (error) {
        console.error("Error durante la validación/registro de licencia en Sheets:", error.message);
        console.error(error.stack);
        return res.status(500).json({ valid: false, message: "Error interno del servidor al validar la licencia." });
    }
});


// --- ENDPOINT: Recopilar datos de usuario ---
app.post('/collect-user-data', async (req, res) => {
    // Asegurarse de que googleSheets esté inicializado
    if (!googleSheets) {
        return res.status(503).json({ success: false, message: "Servicio de base de datos no disponible temporalmente." });
    }

    const { name, email, licenseKey } = req.body;
    const clientIp = req.ip;

    if (!name || !email || !licenseKey) {
        return res.status(400).json({ success: false, message: "Nombre, email y clave de licencia son requeridos." });
    }

    try {
        const timestamp = new Date().toISOString();
        const userData = {
            Name: name,
            Email: email,
            LicenseKey: licenseKey,
            ClientIP: clientIp,
            Timestamp: timestamp
        };
        // Usa la función mejorada para añadir fila
        await appendSheetRow(USERS_SHEET_NAME, userData);
        console.log(`Datos de usuario recopilados: ${email}, ${licenseKey}`);

        // Aquí podrías enviar un email de confirmación específico para la recopilación de datos,
        // diferente al email de bienvenida de validación de licencia si lo deseas.
        // Por ahora, se asume que sendWelcomeEmail ya cubre lo esencial.

        return res.status(200).json({ success: true, message: "Datos recopilados con éxito." });
    } catch (error) {
        console.error("Error al recopilar datos de usuario:", error.message);
        console.error(error.stack);
        return res.status(500).json({ success: false, message: "Error interno del servidor al procesar los datos." });
    }
});

// --- NUEVO ENDPOINT: Establecer Modo de Mantenimiento ---
app.post('/set-maintenance-mode', async (req, res) => {
    // Asegúrate de que googleSheets esté inicializado
    if (!googleSheets) {
        return res.status(503).json({ success: false, message: "Servicio de configuración no disponible temporalmente." });
    }

    const { mode } = req.body; // 'true' o 'false'
    // Implementa aquí alguna lógica de autenticación/autorización para este endpoint
    // por ejemplo, solo permitir desde una IP específica o con una clave de API.
    if (!process.env.ADMIN_API_KEY || req.headers['x-api-key'] !== process.env.ADMIN_API_KEY) {
        console.warn('Intento de cambio de modo de mantenimiento no autorizado.');
        return res.status(403).json({ success: false, message: "Acceso no autorizado." });
    }

    if (mode === 'true' || mode === 'false') {
        try {
            await setAppConfigValue('maintenanceMode', mode);
            maintenanceMode = (mode === 'true'); // Actualiza la variable en memoria
            console.log(`Modo de mantenimiento actualizado a: ${maintenanceMode}`);
            return res.json({ success: true, message: `Modo de mantenimiento establecido a ${maintenanceMode}.` });
        } catch (error) {
            console.error("Error al establecer el modo de mantenimiento:", error.message);
            console.error(error.stack);
            return res.status(500).json({ success: false, message: "Error interno del servidor al establecer el modo de mantenimiento." });
        }
    } else {
        return res.status(400).json({ success: false, message: "El modo debe ser 'true' o 'false'." });
    }
});

// --- NUEVO ENDPOINT: Obtener Estado de Modo de Mantenimiento ---
app.get('/get-maintenance-status', (req, res) => {
    // Este endpoint es accesible incluso en modo mantenimiento para que el frontend pueda verificarlo
    res.json({ maintenanceMode: maintenanceMode });
});

// --- NUEVO ENDPOINT: Generar Licencia ---
app.post('/generate-license', async (req, res) => {
    // Asegúrate de que googleSheets esté inicializado
    if (!googleSheets) {
        return res.status(503).json({ success: false, message: "Servicio de generación de licencias no disponible temporalmente." });
    }
    
    // Autenticación de administrador: Requiere la ADMIN_API_KEY
    if (!process.env.ADMIN_API_KEY || req.headers['x-api-key'] !== process.env.ADMIN_API_KEY) {
        console.warn('Intento de generación de licencia no autorizado.');
        return res.status(403).json({ success: false, message: "Acceso no autorizado para generar licencias." });
    }

    const { maxUniqueIps } = req.body;
    let numMaxIps = parseInt(maxUniqueIps || '1', 10); // Por defecto 1 si no se especifica o es inválido

    if (isNaN(numMaxIps) || numMaxIps <= 0) {
        return res.status(400).json({ success: false, message: "maxUniqueIps debe ser un número entero positivo." });
    }

    try {
        const newLicenseKey = uuidv4(); // Genera un UUID único
        const timestamp = new Date().toISOString();

        // Estructura de la fila para Google Sheets (como objeto)
        const licenseData = {
            LicenseKey: newLicenseKey,
            Activated: 'FALSE', // Por defecto no activada
            MaxUniqueIPs: numMaxIps.toString(), // Convertir a string para la hoja de cálculo
            UniqueIPs: '',      // UniqueIPs vacío inicialmente
            GeneratedAt: timestamp
        };

        await appendSheetRow(LICENSES_SHEET_NAME, licenseData); // Usa la función mejorada
        console.log(`Licencia generada y guardada: ${newLicenseKey} con ${numMaxIps} IPs máximas.`);

        return res.status(200).json({ success: true, message: "Licencia generada correctamente.", licenseKey: newLicenseKey });
    } catch (error) {
        console.error("Error al generar y guardar la licencia:", error.message);
        console.error(error.stack);
        return res.status(500).json({ success: false, message: "Error interno del servidor al generar la licencia." });
    }
});

// Ruta de bienvenida para la raíz (si el frontend se sirve por separado o para verificación)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// --- FUNCIÓN PRINCIPAL PARA INICIAR EL SERVIDOR ---
// Esta sección asegura que la autenticación con Google Sheets
// se complete ANTES de que el servidor comience a escuchar solicitudes.
async function startServer() {
    try {
        console.log('Iniciando autenticación y configuración inicial de Google Sheets...');
        await authenticateGoogleSheets();
        console.log('Google Sheets: Configuración inicial completa. Iniciando servidor Express...');

        // Inicia el servidor Express. Enlaza explícitamente a 0.0.0.0 para compatibilidad en entornos de hosting como Render.
        app.listen(port, '0.0.0.0', () => { 
            console.log(`Servidor de licencias escuchando en http://0.0.0.0:${port}`);
        });
    } catch (error) {
        console.error('ERROR CRÍTICO: El servidor no pudo iniciarse debido a un fallo en la configuración inicial:', error.message);
        process.exit(1); // Sale del proceso si hay un fallo crítico en el inicio
    }
}

// --- LLAMADA FINAL: INICIA LA APLICACIÓN ---
startServer();