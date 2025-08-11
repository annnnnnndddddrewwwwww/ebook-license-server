// server.js
require('dotenv').config();
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const { google } = require('googleapis'); // Importa googleapis
const nodemailer = require('nodemailer'); // Para envío de correos, si se usa

const app = express();
const port = process.env.PORT || 10000; // Puerto por defecto para Render es 10000 o el que Render asigne

// --- Configuración de CORS ---
app.use(cors({
    origin: '*', // Permite cualquier origen. PARA PRODUCCIÓN, REEMPLAZA CON TU DOMINIO REAL.
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// --- Configuración de Google Sheets ---
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
// IMPORTANT: Reemplazar '\\n' con '\n' para claves privadas multilínea en Render
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined;

const LICENSES_SHEET_NAME = 'Licenses';
const USERS_SHEET_NAME = 'Users';
const APP_CONFIG_SHEET_NAME = 'AppConfig';

let sheets; // Variable global para el cliente de Google Sheets API

// Variable para el estado del modo de mantenimiento (se carga de Google Sheets)
let maintenanceMode = false;

// --- Configuración de Nodemailer (para envío de correos) ---
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true', // Asegurarse de que sea booleano
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// Verifica la conexión del transportador de correo
transporter.verify(function (error) {
    if (error) {
        console.error('Error al conectar con el servidor SMTP:', error);
    } else {
        console.log('Servidor SMTP listo para enviar mensajes.');
    }
});


// Función para autenticar y obtener el cliente de Google Sheets
async function authenticateGoogleSheets() {
    try {
        if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
            console.error("ERROR: Faltan variables de entorno para Google Sheets. Por favor, revisa tu archivo .env o la configuración de Render.");
            process.exit(1); // Sale si no puede autenticar
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

    } catch (error) {
        console.error("Error al autenticar con Google Sheets:", error.message);
        process.exit(1); // Sale si la autenticación falla
    }
}

// --- Middleware para obtener la IP del cliente ---
app.set('trust proxy', true); // Necesario para obtener la IP real detrás de un proxy (Render)

// --- Middleware para el modo de mantenimiento (¡DEBE IR ANTES DE TODAS LAS DEMÁS RUTAS!) ---
app.use(async (req, res, next) => { // Marcado como async porque getMaintenanceModeFromSheet es async
    // Si la solicitud es para cambiar o verificar el estado de mantenimiento, déjala pasar
    if (req.path === '/set-maintenance-mode' || req.path === '/get-maintenance-status') {
        return next();
    }

    if (maintenanceMode) { // Usa la variable en memoria que se carga de la hoja
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


// --- Funciones de Utilidad para Google Sheets (Adaptadas a la versión de Googleapis) ---

/**
 * Lee todas las filas de una hoja y las convierte en un array de objetos.
 * Asume que la primera fila son los encabezados.
 * @param {string} sheetName El nombre de la hoja.
 * @returns {Promise<Array<Object>>} Un array de objetos, donde cada objeto es una fila.
 */
async function getSheetData(sheetName) {
    if (!sheets) throw new Error("Google Sheets API no inicializada.");
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetName}!A:Z`,
        });
        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return [];
        }

        const headers = rows[0];
        const data = rows.slice(1).map(row => {
            let obj = {};
            headers.forEach((header, index) => {
                obj[header] = row[index] || '';
            });
            return obj;
        });
        return data;
    } catch (error) {
        console.error(`Error al leer datos de la hoja '${sheetName}':`, error);
        throw error;
    }
}

/**
 * Añade una nueva fila a la hoja.
 * @param {string} sheetName El nombre de la hoja.
 * @param {Object} rowData Los datos de la fila como un objeto (las claves deben coincidir con los encabezados).
 */
async function appendSheetRow(sheetName, rowData) {
    if (!sheets) throw new Error("Google Sheets API no inicializada.");
    try {
        const headers = await getSheetHeaders(sheetName);
        const values = headers.map(header => rowData[header] || '');

        await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetName}!A1`,
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

/**
 * Actualiza una fila existente en la hoja. Si no la encuentra, la añade.
 * @param {string} sheetName El nombre de la hoja.
 * @param {string} identifier El nombre de la columna que identifica la fila (ej. 'licenseKey').
 * @param {string} identifierValue El valor de la columna identificadora para la fila a actualizar.
 * @param {Object} newRowData Los nuevos datos a fusionar en la fila.
 */
async function updateSheetRow(sheetName, identifier, identifierValue, newRowData) {
    if (!sheets) throw new Error("Google Sheets API no inicializada.");
    try {
        const allRows = await getSheetData(sheetName); // Obtener todos los datos para encontrar el índice
        const headers = allRows.length > 0 ? Object.keys(allRows[0]) : await getSheetHeaders(sheetName);

        const rowIndexToUpdate = allRows.findIndex(row => row[identifier] === identifierValue);

        if (rowIndexToUpdate === -1) {
            // Si no se encuentra, añadirla (comportamiento de "upsert")
            console.warn(`No se encontró la fila con ${identifier}='${identifierValue}' para actualizar en ${sheetName}. Se intentará añadir.`);
            await appendSheetRow(sheetName, newRowData);
            return;
        }

        // El índice de fila en Google Sheets es 1-based, y la primera fila es el encabezado.
        const actualSheetRowIndex = rowIndexToUpdate + 2;

        const existingRow = allRows[rowIndexToUpdate];
        const mergedRow = { ...existingRow, ...newRowData };

        const values = headers.map(header => mergedRow[header] || '');

        await sheets.spreadsheets.values.update({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetName}!A${actualSheetRowIndex}`,
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

/**
 * Obtiene los encabezados de una hoja.
 * @param {string} sheetName El nombre de la hoja.
 * @returns {Promise<Array<string>>} Un array con los nombres de los encabezados.
 */
async function getSheetHeaders(sheetName) {
    if (!sheets) throw new Error("Google Sheets API no inicializada.");
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetName}!1:1`,
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
 * @param {string} key El nombre de la configuración a leer.
 * @returns {Promise<string|undefined>} El valor o undefined.
 */
async function getAppConfigValue(key) {
    try {
        const configData = await getSheetData(APP_CONFIG_SHEET_NAME);
        const configEntry = configData.find(row => row.SettingName === key);
        return configEntry ? configEntry.SettingValue : undefined;
    } catch (error) {
        console.error(`Error al leer la configuración '${key}' de Google Sheets:`, error);
        return undefined;
    }
}

/**
 * Guarda un valor de configuración en la hoja 'AppConfig'.
 * @param {string} key El nombre de la configuración a guardar.
 * @param {string} value El valor a guardar.
 */
async function setAppConfigValue(key, value) {
    try {
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
            await setAppConfigValue('maintenanceMode', 'false');
            maintenanceMode = false;
            console.log("Modo de mantenimiento inicializado a false en Google Sheets.");
        } else {
            maintenanceMode = (loadedValue === 'true');
            console.log(`Modo de mantenimiento cargado desde Google Sheets: ${maintenanceMode}`);
        }
    } catch (error) {
        console.error("Error al cargar el modo de mantenimiento al iniciar el servidor:", error);
        maintenanceMode = false; // Fallback a false en caso de error grave
    }
}

// --- Endpoint para OBTENER TODAS las Licencias (para el generador/admin) ---
app.get('/licenses', async (req, res) => {
    if (!sheets) return res.status(503).json({ success: false, message: "Servicio de Google Sheets no disponible." });
    try {
        const licenses = await getSheetData(LICENSES_SHEET_NAME);
        // Formatear datos para el cliente (generator.py)
        licenses.forEach(lic => {
            lic.usedIPs = lic.usedIPs ? lic.usedIPs.split(',').filter(ip => ip.trim() !== '') : [];
            lic.isUsed = lic.isUsed === 'true'; // Convertir string 'true'/'false' a booleano
            lic.MaxIPs = parseInt(lic.MaxIPs, 10); // Asegurarse de que sea número
            if (isNaN(lic.MaxIPs)) lic.MaxIPs = 1; // Fallback si es NaN
        });
        res.json({ success: true, licenses: licenses }); // Envolver en 'licenses' para consistencia
    } catch (error) {
        console.error("Error al obtener licencias:", error);
        res.status(500).json({ success: false, message: "Error interno del servidor al obtener licencias." });
    }
});

// --- Endpoint para OBTENER TODOS los Datos de Usuario (para el generador/admin) ---
app.get('/users', async (req, res) => {
    if (!sheets) return res.status(503).json({ success: false, message: "Servicio de Google Sheets no disponible." });
    try {
        const users = await getSheetData(USERS_SHEET_NAME);
        res.json({ success: true, users: users });
    } catch (error) {
        console.error("Error al obtener datos de usuarios:", error);
        res.status(500).json({ success: false, message: "Error interno del servidor al obtener datos de usuarios." });
    }
});

// --- Endpoint para el Generador de Licencias ---
app.post('/generate-license', async (req, res) => {
    if (!sheets) return res.status(503).json({ success: false, message: "Servicio de Google Sheets no disponible." });

    const newLicenseKey = uuidv4();
    // maxIPs viene de generator.py
    let maxIPs = req.body.maxIPs ? parseInt(req.body.maxIPs, 10) : 1;

    if (isNaN(maxIPs) || maxIPs < 1) {
        maxIPs = 1; // Asegurar un valor numérico y positivo
        console.warn(`Valor de MaxIPs inválido o no proporcionado (${req.body.maxIPs}). Usando ${maxIPs} por defecto.`);
    }

    const createdAt = new Date().toISOString();
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 1); // Licencia válida por 1 año

    const licenseData = {
        licenseKey: newLicenseKey,
        MaxIPs: maxIPs.toString(), // Guardar como string para Google Sheets
        usedIPs: '',                // Inicialmente vacío
        isUsed: 'false',            // Guardar como string 'false'
        ExpiryDate: expiryDate.toISOString().split('T')[0], // Formato YYYY-MM-DD
        createdAt: createdAt,
        lastUsedIP: '',             // Inicialmente vacío
        lastUsedAt: ''              // Inicialmente vacío
    };

    try {
        await appendSheetRow(LICENSES_SHEET_NAME, licenseData);
        console.log(`Licencia generada y añadida: ${newLicenseKey} (Máx IPs: ${maxIPs})`);
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

        if (licenseToUpdate.isUsed === 'false') { // Compara con el string 'false' de la hoja
            return res.status(200).json({ success: true, message: "La licencia ya estaba invalidada." });
        }

        const newLicenseData = { isUsed: 'false' }; // Actualiza el campo isUsed
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

    // licensing.js envía 'license', 'userName', 'userEmail'
    const { license: incomingLicenseKey, userName, userEmail } = req.body;
    const clientIp = req.ip;

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

        if (licenseData.isUsed === 'false') { // Compara con el string 'false' de la hoja
            console.log(`Intento de validación con clave invalidada: '${incomingLicenseKey}'. IP: ${clientIp}`);
            return res.status(403).json({ valid: false, message: "Esta licencia ha sido invalidada y ya no es válida." });
        }

        // --- Verificación de caducidad (columna ExpiryDate) ---
        const expiryDateStr = licenseData.ExpiryDate;
        const expiryDate = new Date(expiryDateStr);
        // Validar si la fecha es válida y si ya ha caducado
        if (isNaN(expiryDate.getTime()) || expiryDate < new Date()) {
             console.log(`Licencia '${incomingLicenseKey}' caducada o fecha inválida. IP: ${clientIp}`);
             return res.status(403).json({ valid: false, message: "La licencia ha caducado o su fecha de vencimiento es inválida." });
        }


        // --- Obtener MaxIPs (¡Solución para el 'NaN'!) ---
        let maxIPsNum = parseInt(licenseData.MaxIPs, 10);
        if (isNaN(maxIPsNum) || maxIPsNum < 1) {
            // Fallback robusto si el valor en la hoja es inválido
            maxIPsNum = parseInt(process.env.MAX_IPS_PER_LICENSE || '1', 10); // Intenta de la variable de entorno
            if (isNaN(maxIPsNum) || maxIPsNum < 1) {
                maxIPsNum = 1; // Último recurso: 1 IP por defecto
            }
            console.warn(`MaxIPs para la licencia '${incomingLicenseKey}' en la hoja es inválido o no existe. Usando el valor por defecto: ${maxIPsNum}`);
        }

        // --- Obtener IPs usadas actualmente ---
        let usedIPsArray = licenseData.usedIPs ? licenseData.usedIPs.split(',').filter(ip => ip.trim() !== '') : [];
        const isIpAlreadyUsed = usedIPsArray.includes(clientIp);

        if (isIpAlreadyUsed) {
            // Si la IP ya está registrada, solo actualiza la fecha de último uso
            await updateSheetRow(LICENSES_SHEET_NAME, 'licenseKey', incomingLicenseKey, {
                lastUsedIP: clientIp,
                lastUsedAt: new Date().toISOString()
            });
            console.log(`Licencia '${incomingLicenseKey}' re-validada por IP: ${clientIp}. IPs únicas usadas: ${usedIPsArray.length}/${maxIPsNum}`);
            res.json({ valid: true, message: "Licencia válida." });
        } else {
            // Si la IP no está registrada
            if (usedIPsArray.length < maxIPsNum) {
                // Registrar nueva IP
                usedIPsArray.push(clientIp);
                const newUsedIPsString = usedIPsArray.join(',');
                await updateSheetRow(LICENSES_SHEET_NAME, 'licenseKey', incomingLicenseKey, {
                    usedIPs: newUsedIPsString,
                    isUsed: 'true', // Marcar como usada si es la primera IP
                    lastUsedIP: clientIp,
                    lastUsedAt: new Date().toISOString()
                });
                console.log(`Licencia '${incomingLicenseKey}' activada por nueva IP: ${clientIp}. IPs únicas usadas: ${usedIPsArray.length}/${maxIPsNum}`);
                res.json({ valid: true, message: "Licencia válida y activada para esta IP." });
            } else {
                // Límite de IPs alcanzado
                console.log(`Licencia '${incomingLicenseKey}' ha alcanzado su límite de ${maxIPsNum} IPs únicas. Intento de uso por IP: ${clientIp}`);
                res.status(403).json({ valid: false, message: `Esta licencia ya ha sido activada por su número máximo de ${maxIPsNum} IPs diferentes.` });
            }
        }
    } catch (error) {
        console.error("Error durante la validación/registro de licencia en Sheets:", error);
        res.status(500).json({ valid: false, message: "Error interno del servidor." });
    }
});

// --- ENDPOINT: Recopilar datos de usuario ---
app.post('/collect-user-data', async (req, res) => {
    if (!sheets) return res.status(503).json({ success: false, message: "Servicio de Google Sheets no disponible." });

    const { userName, userEmail, licenseKey } = req.body; // No necesitas timestamp, lo generamos aquí
    const timestamp = new Date().toISOString(); // Generar timestamp en el servidor

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
            // Mantener el primer acceso si ya existe, de lo contrario, usar el timestamp actual
            firstAccess: existingUser ? existingUser.firstAccess : timestamp
        };

        if (existingUser) {
            await updateSheetRow(USERS_SHEET_NAME, 'userEmail', userEmail, userData);
            console.log(`Datos de usuario actualizados para ${userEmail}.`);
        } else {
            await appendSheetRow(USERS_SHEET_NAME, userData);
            console.log(`Nuevo usuario registrado: ${userEmail}.`);
        }

        res.status(200).json({ success: true, message: "Datos de usuario registrados." });

    } catch (error) {
        console.error("Error al registrar datos de usuario en Sheets:", error);
        res.status(500).json({ success: false, message: "Error interno del servidor al registrar datos de usuario." });
    }
});

// --- NUEVO ENDPOINT: Establecer Modo de Mantenimiento ---
app.post('/set-maintenance-mode', async (req, res) => {
    const { maintenanceMode: newState } = req.body;
    if (typeof newState === 'boolean') {
        maintenanceMode = newState; // Actualiza la variable en memoria
        await setAppConfigValue('maintenanceMode', newState.toString());
        console.log(`Modo de mantenimiento cambiado a: ${maintenanceMode}`);
        res.json({ success: true, message: `Modo de mantenimiento establecido a ${newState}` });
    } else {
        res.status(400).json({ success: false, message: "Parámetro 'maintenanceMode' inválido. Debe ser true o false." });
    }
});

// --- NUEVO ENDPOINT: Obtener Estado de Modo de Mantenimiento ---
app.get('/get-maintenance-status', (req, res) => {
    res.json({ maintenanceMode: maintenanceMode });
});


// Ruta de bienvenida (opcional, para verificar que el servidor está corriendo)
app.get('/', (req, res) => {
    res.send('Servidor de licencias de Ebook funcionando con Google Sheets. Usa /generate-license para generar, /validate-and-register-license para validar, /licenses para ver todas las licencias y /users para ver los datos de usuario.');
});

// Iniciar el servidor
async function startServer() {
    await authenticateGoogleSheets();
    app.listen(port, () => {
        console.log(`Servidor de licencias escuchando en el puerto ${port}`);
        console.log(`ID de Google Sheet: ${GOOGLE_SHEET_ID}`);
    });
}

startServer();