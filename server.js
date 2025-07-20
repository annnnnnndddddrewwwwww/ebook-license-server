// server.js
require('dotenv').config();
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const { google } = require('googleapis');
const { sendWelcomeEmail, initializeEmailTransporter } = require('./emailService'); // Import the email service

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
const APP_CONFIG_SHEET_NAME = 'AppConfig'; // NUEVA: Nombre de la pestaña para configuración de la app

let sheets; // Variable global para el cliente de Google Sheets
let maintenanceMode = false; // Estado inicial del modo de mantenimiento

// --- Función para autenticar con Google Sheets y cargar configuración inicial ---
async function authenticateGoogleSheets() {
    try {
        if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
            console.error("Faltan variables de entorno para Google Sheets.");
            return;
        }

        const auth = new google.auth.JWT(
            GOOGLE_SERVICE_ACCOUNT_EMAIL,
            null,
            GOOGLE_PRIVATE_KEY,
            ['https://www.googleapis.com/auth/spreadsheets']
        );

        await auth.authorize();
        sheets = google.sheets({ version: 'v4', auth });
        console.log("Autenticación con Google Sheets exitosa!");

        // --- Cargar el estado inicial del modo de mantenimiento desde Google Sheets ---
        await loadMaintenanceModeFromSheet();

        // --- Inicializar el servicio de correo ---
        await initializeEmailTransporter(); // Initialize the email service here
        console.log("Servicio de correo inicializado.");

    } catch (error) {
        console.error("Error al autenticar con Google Sheets o inicializar el servicio de correo:", error.message);
        // Opcional: Reintentar conexión después de un tiempo si la autenticación falla
        // setTimeout(authenticateGoogleSheets, 5000);
    }
}

// Llama a la función de autenticación al iniciar el servidor
authenticateGoogleSheets();

// --- Middleware para Modo de Mantenimiento ---
app.use((req, res, next) => {
    // Permite que las peticiones a /set-maintenance-mode y /get-maintenance-status pasen siempre
    if (req.path === '/set-maintenance-mode' || req.path === '/get-maintenance-status' || req.path === '/') {
        return next();
    }
    if (maintenanceMode) {
        return res.status(503).json({
            success: false,
            message: "El servicio está actualmente en modo de mantenimiento. Por favor, inténtalo de nuevo más tarde."
        });
    }
    next();
});

// --- Funciones auxiliares para Google Sheets ---
async function getSheetData(sheetName) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${sheetName}!A:Z`,
    });
    const rows = response.data.values;
    if (!rows || rows.length === 0) {
        return [];
    }
    const headers = rows[0];
    return rows.slice(1).map(row => {
        let obj = {};
        headers.forEach((header, index) => {
            obj[header] = row[index] || null;
        });
        return obj;
    });
}

async function appendSheetRow(sheetName, data) {
    const allHeaders = await getSheetHeaders(sheetName);
    const values = allHeaders.map(header => data[header] !== undefined ? data[header] : '');
    await sheets.spreadsheets.values.append({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${sheetName}!A:Z`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: {
            values: [values],
        },
    });
}

async function updateSheetRow(sheetName, keyColumn, keyValue, data) {
    const allData = await getSheetData(sheetName);
    const rowIndex = allData.findIndex(row => row[keyColumn] === keyValue);

    if (rowIndex === -1) {
        throw new Error(`Fila no encontrada para ${keyColumn}: ${keyValue}`);
    }

    const headers = await getSheetHeaders(sheetName);
    const rowToUpdate = allData[rowIndex];
    const updatedRowValues = headers.map(header => {
        return data[header] !== undefined ? data[header] : rowToUpdate[header];
    });

    // Las filas en la API de Sheets son 1-indexadas y se cuenta el encabezado
    const sheetRowIndex = rowIndex + 2; // +1 por los encabezados, +1 porque es 1-indexed

    await sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${sheetName}!A${sheetRowIndex}:Z${sheetRowIndex}`,
        valueInputOption: 'RAW',
        resource: {
            values: [updatedRowValues],
        },
    });
}

async function getSheetHeaders(sheetName) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${sheetName}!1:1`, // Solo la primera fila para encabezados
    });
    return response.data.values[0];
}

// --- Funciones para la hoja de configuración de la aplicación (AppConfig) ---
async function getAppConfigValue(key) {
    const configData = await getSheetData(APP_CONFIG_SHEET_NAME);
    const configItem = configData.find(item => item.Key === key);
    return configItem ? configItem.Value : null;
}

async function setAppConfigValue(key, value) {
    const configData = await getSheetData(APP_CONFIG_SHEET_NAME);
    const existingConfig = configData.find(item => item.Key === key);

    if (existingConfig) {
        await updateSheetRow(APP_CONFIG_SHEET_NAME, 'Key', key, { Key: key, Value: value });
    } else {
        await appendSheetRow(APP_CONFIG_SHEET_NAME, { Key: key, Value: value });
    }
}

async function loadMaintenanceModeFromSheet() {
    const storedMaintenanceMode = await getAppConfigValue('maintenanceMode');
    if (storedMaintenanceMode !== null) {
        maintenanceMode = storedMaintenanceMode === 'true';
        console.log(`Modo de mantenimiento cargado desde Sheets: ${maintenanceMode}`);
    } else {
        // Si no existe, lo establecemos por defecto en false y lo guardamos
        await setAppConfigValue('maintenanceMode', 'false');
        maintenanceMode = false;
        console.log("Modo de mantenimiento inicializado en false y guardado en Sheets.");
    }
}

// --- ENDPOINT: Obtener todas las licencias ---
app.get('/licenses', async (req, res) => {
    if (!sheets) return res.status(503).json({ success: false, message: "Servicio de Google Sheets no disponible." });
    try {
        const licenses = await getSheetData(LICENSES_SHEET_NAME);
        res.json({ success: true, licenses: licenses });
    } catch (error) {
        console.error("Error al obtener licencias de Sheets:", error);
        res.status(500).json({ success: false, message: "Error interno del servidor al obtener licencias." });
    }
});

// --- ENDPOINT: Obtener todos los usuarios ---
app.get('/users', async (req, res) => {
    if (!sheets) return res.status(503).json({ success: false, message: "Servicio de Google Sheets no disponible." });
    try {
        const users = await getSheetData(USERS_SHEET_NAME);
        res.json({ success: true, users: users });
    } catch (error) {
        console.error("Error al obtener usuarios de Sheets:", error);
        res.status(500).json({ success: false, message: "Error interno del servidor al obtener usuarios." });
    }
});

// --- ENDPOINT: Generar una nueva licencia ---
app.post('/generate-license', async (req, res) => {
    if (!sheets) return res.status(503).json({ success: false, message: "Servicio de Google Sheets no disponible." });

    const licenseKey = uuidv4();
    const timestamp = new Date().toISOString();

    try {
        await appendSheetRow(LICENSES_SHEET_NAME, {
            licenseKey: licenseKey,
            status: 'active',
            generatedAt: timestamp,
            activatedAt: null,
            userEmail: null,
            userName: null
        });
        res.status(201).json({ success: true, licenseKey: licenseKey });
    } catch (error) {
        console.error("Error al generar licencia en Sheets:", error);
        res.status(500).json({ success: false, message: "Error interno del servidor al generar licencia." });
    }
});

// --- ENDPOINT: Invalidar una licencia ---
app.post('/invalidate-license', async (req, res) => {
    if (!sheets) return res.status(503).json({ success: false, message: "Servicio de Google Sheets no disponible." });

    const { licenseKey } = req.body;
    if (!licenseKey) {
        return res.status(400).json({ success: false, message: "Clave de licencia es requerida." });
    }

    try {
        const licenses = await getSheetData(LICENSES_SHEET_NAME);
        const licenseToInvalidate = licenses.find(lic => lic.licenseKey === licenseKey);

        if (!licenseToInvalidate) {
            return res.status(404).json({ success: false, message: "Licencia no encontrada." });
        }

        if (licenseToInvalidate.status === 'invalid') {
            return res.status(400).json({ success: false, message: "La licencia ya está invalidada." });
        }

        await updateSheetRow(LICENSES_SHEET_NAME, 'licenseKey', licenseKey, { status: 'invalid' });
        res.json({ success: true, message: "Licencia invalidada correctamente." });

    } catch (error) {
        console.error("Error al invalidar licencia en Sheets:", error);
        res.status(500).json({ success: false, message: "Error interno del servidor al invalidar licencia." });
    }
});

// --- ENDPOINT: Validar y registrar licencia ---
app.post('/validate-and-register-license', async (req, res) => {
    if (!sheets) return res.status(503).json({ success: false, message: "Servicio de Google Sheets no disponible." });

    const { licenseKey, userName, userEmail } = req.body;

    if (!licenseKey || !userName || !userEmail) {
        return res.status(400).json({ success: false, message: "Clave de licencia, nombre de usuario y email son requeridos." });
    }

    try {
        const licenses = await getSheetData(LICENSES_SHEET_NAME);
        const licenseEntry = licenses.find(lic => lic.licenseKey === licenseKey);

        if (!licenseEntry) {
            return res.status(404).json({ success: false, message: "Licencia no encontrada." });
        }

        if (licenseEntry.status === 'invalid') {
            return res.status(400).json({ success: false, message: "Licencia inválida o ya utilizada." });
        }

        const timestamp = new Date().toISOString();
        let updateData = {
            status: 'active', // Aseguramos que el estado es activo si se valida
            activatedAt: licenseEntry.activatedAt || timestamp, // Solo se setea la primera vez
            userName: userName,
            userEmail: userEmail
        };

        // Si la licencia ya estaba asociada a un email diferente, se considera inválida para el nuevo
        if (licenseEntry.userEmail && licenseEntry.userEmail !== userEmail) {
            // Opcional: podrías cambiar el status a 'compromised' o 'reused'
            await updateSheetRow(LICENSES_SHEET_NAME, 'licenseKey', licenseKey, { status: 'invalid' });
            return res.status(409).json({ success: false, message: "Esta licencia ya ha sido registrada por otro usuario." });
        }

        await updateSheetRow(LICENSES_SHEET_NAME, 'licenseKey', licenseKey, updateData);

        // Actualizar o registrar datos del usuario
        // Esta parte se manejará en el endpoint /collect-user-data,
        // para asegurar un único punto de entrada para el registro de usuario.
        // Aquí solo validamos la licencia y la asociamos.

        res.json({ success: true, message: "Licencia validada y registrada correctamente." });

    } catch (error) {
        console.error("Error al validar/registrar licencia en Sheets:", error);
        res.status(500).json({ success: false, message: "Error interno del servidor al validar/registrar licencia." });
    }
});

// --- ENDPOINT: Recopilar datos de usuario ---
app.post('/collect-user-data', async (req, res) => {
    if (!sheets) return res.status(503).json({ success: false, message: "Servicio de Google Sheets no disponible." });

    const { userName, userEmail, licenseKey, timestamp } = req.body;

    if (!userEmail || !licenseKey) {
        return res.status(400).json({ success: false, message: "Email y clave de licencia son requeridos." });
    }

    try {
        const allUsers = await getSheetData(USERS_SHEET_NAME);
        const existingUser = allUsers.find(user => user.userEmail === userEmail);

        const userData = {
            userName: userName || 'N/A',
            userEmail: userEmail,
            licenseKey: licenseKey,
            lastAccess: timestamp,
            firstAccess: existingUser ? existingUser.firstAccess : timestamp
        };

        if (existingUser) {
            await updateSheetRow(USERS_SHEET_NAME, 'userEmail', userEmail, userData);
            console.log(`Datos de usuario actualizados para ${userEmail}.`);
        } else {
            await appendSheetRow(USERS_SHEET_NAME, userData);
            console.log(`Nuevo usuario registrado: ${userEmail}.`);
            
            // --- Send Welcome Email to New User ---
            const emailResult = await sendWelcomeEmail(userEmail, userName, licenseKey);
            if (emailResult.success) {
                console.log(`Correo de bienvenida enviado a ${userEmail}.`);
            } else {
                console.warn(`No se pudo enviar el correo de bienvenida a ${userEmail}: ${emailResult.error}`);
            }
        }
        
        res.status(200).json({ success: true, message: "Datos de usuario registrados." });

    } catch (error) {
        console.error("Error al registrar datos de usuario en Sheets o enviar correo:", error);
        res.status(500).json({ success: false, message: "Error interno del servidor al registrar datos de usuario." });
    }
});

// --- ENDPOINT: Establecer Modo de Mantenimiento ---
app.post('/set-maintenance-mode', async (req, res) => { // Marcado como async
    const { maintenanceMode: newState } = req.body;
    if (typeof newState === 'boolean') {
        maintenanceMode = newState; // Actualiza la variable en memoria
        // Persistir el estado en Google Sheets
        await setAppConfigValue('maintenanceMode', newState.toString()); 
        console.log(`Modo de mantenimiento cambiado a: ${maintenanceMode}`);
        res.json({ success: true, message: `Modo de mantenimiento establecido a ${newState}` });
    } else {
        res.status(400).json({ success: false, message: "Parámetro 'maintenanceMode' inválido. Debe ser true o false." });
    }
});

// --- NUEVO ENDPOINT: Obtener Estado de Modo de Mantenimiento ---
app.get('/get-maintenance-status', (req, res) => {
    res.json({ maintenanceMode: maintenanceMode }); // Retorna el estado actual en memoria (que está sincronizado con la hoja)
});


// Ruta de bienvenida (opcional, para verificar que el servidor está corriendo)
app.get('/', (req, res) => {
    res.send('Servidor de licencias de Ebook funcionando con Google Sheets. Usa /generate-license para generar, /validate-and-register-license para validar, /licenses para ver todas las licencias y /users para ver los datos de usuario.');
});

// Iniciar el servidor
app.listen(port, () => {
    console.log(`Servidor de licencias escuchando en el puerto ${port}`);
    console.log(`ID de Google Sheet: ${GOOGLE_SHEET_ID}`);
});