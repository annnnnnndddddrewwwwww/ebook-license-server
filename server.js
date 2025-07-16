// server.js
require('dotenv').config(); // Carga las variables de entorno desde .env (solo para desarrollo local)
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const { google } = require('googleapis'); // Importa googleapis

const nodemailer = require('nodemailer'); // <-- ADD THIS LINE

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

// Configuración del transporter de correo electrónico (ejemplo con Gmail)
const transporter = nodemailer.createTransport({
    service: 'gmail', // Puedes usar 'smtp.mailtrap.io' para pruebas o tu proveedor de correo
    auth: {
        user: process.env.EMAIL_USER,    // Tu correo electrónico (ej. 'tu.email@gmail.com')
        pass: process.env.EMAIL_PASS,    // Tu contraseña de aplicación (para Gmail, no tu contraseña normal)
    },
});

// --- Inicialización de Google Sheets ---
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
        console.log('Conexión con Google Sheets establecida.');

        // Cargar el modo de mantenimiento al iniciar
        const maintenanceModeValue = await getAppConfigValue('maintenanceMode');
        maintenanceMode = (maintenanceModeValue === 'true');
        console.log(`Modo de mantenimiento inicial: ${maintenanceMode ? 'ACTIVO' : 'DESACTIVADO'}`);

    } catch (error) {
        console.error('Error al conectar con Google Sheets:', error.message);
        process.exit(1); // Sale de la aplicación si no se puede conectar a Google Sheets
    }
}

// Function to append a row to a sheet
async function appendSheetRow(sheetName, rowData) {
    try {
        const response = await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: sheetName,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [rowData],
            },
        });
        console.log(`Fila añadida a ${sheetName}.`);
        return response.data;
    } catch (error) {
        console.error(`Error al añadir fila a ${sheetName}:`, error.message);
        throw error;
    }
}

// Function to get all rows from a sheet
async function getSheetRows(sheetName) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: sheetName,
        });
        return response.data.values || [];
    } catch (error) {
        console.error(`Error al obtener filas de ${sheetName}:`, error.message);
        throw error;
    }
}

// Function to update a specific cell (for app config)
async function updateSheetCell(sheetName, range, value) {
    try {
        await sheets.spreadsheets.values.update({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetName}!${range}`,
            valueInputOption: 'RAW',
            resource: {
                values: [[value]],
            },
        });
        console.log(`Celda ${sheetName}!${range} actualizada a: ${value}`);
    } catch (error) {
        console.error(`Error al actualizar celda ${sheetName}!${range}:`, error.message);
        throw error;
    }
}

// Function to get a specific value from AppConfig sheet
async function getAppConfigValue(key) {
    try {
        const rows = await getSheetRows(APP_CONFIG_SHEET_NAME);
        const header = rows[0];
        const dataRows = rows.slice(1);

        const keyColumnIndex = header.indexOf('Key');
        const valueColumnIndex = header.indexOf('Value');

        if (keyColumnIndex === -1 || valueColumnIndex === -1) {
            console.warn(`Encabezados 'Key' o 'Value' no encontrados en la hoja '${APP_CONFIG_SHEET_NAME}'.`);
            return null;
        }

        const configRow = dataRows.find(row => row[keyColumnIndex] === key);
        return configRow ? configRow[valueColumnIndex] : null;

    } catch (error) {
        console.error(`Error al obtener valor de configuración para '${key}':`, error.message);
        return null;
    }
}

// Function to set a specific value in AppConfig sheet
async function setAppConfigValue(key, value) {
    try {
        const rows = await getSheetRows(APP_CONFIG_SHEET_NAME);
        const header = rows[0];
        const dataRows = rows.slice(1);

        const keyColumnIndex = header.indexOf('Key');
        const valueColumnIndex = header.indexOf('Value');

        if (keyColumnIndex === -1 || valueColumnIndex === -1) {
            throw new Error(`Encabezados 'Key' o 'Value' no encontrados en la hoja '${APP_CONFIG_SHEET_NAME}'.`);
        }

        let rowIndex = dataRows.findIndex(row => row[keyColumnIndex] === key);
        if (rowIndex === -1) {
            // If key does not exist, append a new row
            await appendSheetRow(APP_CONFIG_SHEET_NAME, [key, value]);
        } else {
            // If key exists, update the existing row
            // +2 because Sheets API is 1-indexed and we skipped header row
            const actualRowInSheet = rowIndex + 2;
            const range = `${String.fromCharCode(65 + valueColumnIndex)}${actualRowInSheet}`; // Convert index to column letter
            await updateSheetCell(APP_CONFIG_SHEET_NAME, range, value);
        }
    } catch (error) {
        console.error(`Error al establecer valor de configuración para '${key}':`, error.message);
        throw error; // Re-throw to propagate the error
    }
}

let maintenanceMode = false; // Estado del modo de mantenimiento, por defecto desactivado

// --- Rutas de la API ---

// Ruta para generar una nueva licencia
app.post('/generate-license', async (req, res) => {
    if (maintenanceMode) {
        return res.status(503).json({ success: false, message: 'El servicio está en modo de mantenimiento. Por favor, inténtalo de nuevo más tarde.' });
    }

    const { maxUniqueIps = 1 } = req.body; // Default to 1 if not provided

    const newLicense = {
        licenseKey: uuidv4(),
        // status: 'unused', // ¡Campo 'status' eliminado aquí!
        generatedDate: new Date().toISOString(),
        maxUniqueIps: maxUniqueIps,
        // usedBy: '', // Estos campos serán rellenados cuando la licencia se use
        // usedDate: '',
        // invalidatedBy: '',
        // invalidatedDate: ''
    };

    // Asegúrate de que el orden de los valores coincida con el orden de las columnas en tu hoja de Google Sheets.
    // Si tu hoja 'Licenses' ahora tiene una columna menos o diferente orden, ajústalo aquí.
    const rowData = [
        newLicense.licenseKey,
        // Ya no enviamos newLicense.status
        newLicense.generatedDate,
        newLicense.maxUniqueIps,
        '', // Espacio para usedBy
        '', // Espacio para usedDate
        '', // Espacio para invalidatedBy
        ''  // Espacio para invalidatedDate
    ];

    try {
        await appendSheetRow(LICENSES_SHEET_NAME, rowData);
        res.status(201).json({ success: true, message: 'Licencia generada y guardada.', license: newLicense.licenseKey });
    } catch (error) {
        console.error('Error al generar y guardar licencias:', error.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor al generar licencia.' });
    }
});

// Ruta para validar y registrar una licencia
app.post('/validate-and-register-license', async (req, res) => {
    if (maintenanceMode) {
        return res.status(503).json({ success: false, message: 'El servicio está en modo de mantenimiento. Por favor, inténtalo de nuevo más tarde.' });
    }

    const { licenseKey, userName, userEmail } = req.body;

    if (!licenseKey || !userName || !userEmail) {
        return res.status(400).json({ success: false, message: 'Faltan parámetros: licenseKey, userName y userEmail son obligatorios.' });
    }

    try {
        const licenses = await getSheetRows(LICENSES_SHEET_NAME);
        const users = await getSheetRows(USERS_SHEET_NAME);

        const licenseHeader = licenses[0];
        const licenseDataRows = licenses.slice(1);
        const userHeader = users[0];
        const userDataRows = users.slice(1);

        const licenseKeyColIndex = licenseHeader.indexOf('licenseKey');
        const statusColIndex = licenseHeader.indexOf('status');
        const maxUniqueIpsColIndex = licenseHeader.indexOf('maxUniqueIps');
        const usedByColIndex = licenseHeader.indexOf('usedBy');
        const usedDateColIndex = licenseHeader.indexOf('usedDate');

        const userNameColIndex = userHeader.indexOf('userName');
        const userEmailColIndex = userHeader.indexOf('userEmail');
        const lastAccessColIndex = userHeader.indexOf('lastAccess');

        if (licenseKeyColIndex === -1 || statusColIndex === -1 || maxUniqueIpsColIndex === -1 ||
            usedByColIndex === -1 || usedDateColIndex === -1 || userNameColIndex === -1 ||
            userEmailColIndex === -1 || lastAccessColIndex === -1) {
            return res.status(500).json({ success: false, message: 'Error de configuración: Faltan encabezados de columna en Google Sheets.' });
        }

        let foundLicenseRowIndex = -1;
        let licenseData = null;

        // Find the license and its original row index in the sheet (1-indexed for Sheets API, plus header)
        for (let i = 0; i < licenseDataRows.length; i++) {
            if (licenseDataRows[i][licenseKeyColIndex] === licenseKey) {
                foundLicenseRowIndex = i + 2; // +2 for 1-based index and header row
                licenseData = licenseDataRows[i];
                break;
            }
        }

        if (!licenseData) {
            return res.status(404).json({ success: false, message: 'Licencia no encontrada.' });
        }

        // --- Validación de licencia ---
        const currentStatus = licenseData[statusColIndex];
        const currentUsedBy = licenseData[usedByColIndex];
        const currentMaxIps = parseInt(licenseData[maxUniqueIpsColIndex] || '1', 10);

        if (currentStatus === 'used' && currentUsedBy !== userEmail) {
            return res.status(403).json({ success: false, message: 'Esta licencia ya está en uso por otro usuario.' });
        }
        if (currentStatus === 'invalidated') {
            return res.status(403).json({ success: false, message: 'Esta licencia ha sido invalidada.' });
        }

        // --- Registro/Actualización de usuario ---
        let foundUserRowIndex = -1;
        let userData = null;
        for (let i = 0; i < userDataRows.length; i++) {
            if (userDataRows[i][userEmailColIndex] === userEmail) {
                foundUserRowIndex = i + 2; // +2 for 1-based index and header row
                userData = userDataRows[i];
                break;
            }
        }

        const now = new Date().toISOString();

        if (userData) {
            // Update existing user
            await updateSheetCell(USERS_SHEET_NAME, `C${foundUserRowIndex}`, now); // Update lastAccess
            // Ensure userName is consistent if email is the same
            if (userData[userNameColIndex] !== userName) {
                await updateSheetCell(USERS_SHEET_NAME, `A${foundUserRowIndex}`, userName);
            }
        } else {
            // Add new user
            await appendSheetRow(USERS_SHEET_NAME, [userName, userEmail, now]);
        }

        // --- Actualización de la licencia ---
        if (currentStatus === 'unused') {
            // Update status to 'used', set usedBy and usedDate
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `${LICENSES_SHEET_NAME}!B${foundLicenseRowIndex}`, // Column B is status
                valueInputOption: 'RAW',
                resource: {
                    values: [['used']],
                },
            });
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `${LICENSES_SHEET_NAME}!D${foundLicenseRowIndex}`, // Column D is usedBy
                valueInputOption: 'RAW',
                resource: {
                    values: [[userEmail]],
                },
            });
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `${LICENSES_SHEET_NAME}!E${foundLicenseRowIndex}`, // Column E is usedDate
                valueInputOption: 'RAW',
                resource: {
                    values: [[now]],
                },
            });
            res.json({ success: true, message: 'Licencia validada y registrada correctamente.' });
        } else if (currentStatus === 'used') {
            // License already in use by this user, just re-validate
            res.json({ success: true, message: 'Licencia ya validada para este usuario.' });
        } else {
            res.status(400).json({ success: false, message: 'Estado de licencia desconocido.' });
        }

    } catch (error) {
        console.error('Error al validar la licencia:', error.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor al validar licencia.' });
    }
});


// Ruta para invalidar una licencia (ej. por un administrador)
app.post('/invalidate-license', async (req, res) => {
    if (maintenanceMode) {
        return res.status(503).json({ success: false, message: 'El servicio está en modo de mantenimiento. Por favor, inténtalo de nuevo más tarde.' });
    }
    const { licenseKey, invalidatedBy } = req.body;

    if (!licenseKey || !invalidatedBy) {
        return res.status(400).json({ success: false, message: 'Faltan licenseKey o invalidatedBy.' });
    }

    try {
        const licenses = await getSheetRows(LICENSES_SHEET_NAME);
        const header = licenses[0];
        const dataRows = licenses.slice(1);

        const licenseKeyColIndex = header.indexOf('licenseKey');
        const statusColIndex = header.indexOf('status');
        const invalidatedByColIndex = header.indexOf('invalidatedBy');
        const invalidatedDateColIndex = header.indexOf('invalidatedDate');

        if (licenseKeyColIndex === -1 || statusColIndex === -1 || invalidatedByColIndex === -1 || invalidatedDateColIndex === -1) {
            return res.status(500).json({ success: false, message: 'Error de configuración: Faltan encabezados de columna en Google Sheets para invalidación.' });
        }

        let foundRowIndex = -1;
        let licenseData = null;

        for (let i = 0; i < dataRows.length; i++) {
            if (dataRows[i][licenseKeyColIndex] === licenseKey) {
                foundRowIndex = i + 2; // +2 for 1-based index and header row
                licenseData = dataRows[i];
                break;
            }
        }

        if (!licenseData) {
            return res.status(404).json({ success: false, message: 'Licencia no encontrada.' });
        }

        if (licenseData[statusColIndex] === 'invalidated') {
            return res.status(400).json({ success: false, message: 'Esta licencia ya ha sido invalidada.' });
        }

        // Actualizar el estado a 'invalidated', y rellenar invalidatedBy y invalidatedDate
        await sheets.spreadsheets.values.update({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${LICENSES_SHEET_NAME}!B${foundRowIndex}`, // Columna B es status
            valueInputOption: 'RAW',
            resource: {
                values: [['invalidated']],
            },
        });
        await sheets.spreadsheets.values.update({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${LICENSES_SHEET_NAME}!F${foundRowIndex}`, // Columna F es invalidatedBy
            valueInputOption: 'RAW',
            resource: {
                values: [[invalidatedBy]],
            },
        });
        await sheets.spreadsheets.values.update({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${LICENSES_SHEET_NAME}!G${foundRowIndex}`, // Columna G es invalidatedDate
            valueInputOption: 'RAW',
            resource: {
                values: [[new Date().toISOString()]],
            },
        });

        res.json({ success: true, message: 'Licencia invalidada correctamente.' });

    } catch (error) {
        console.error('Error al invalidar licencia:', error.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor al invalidar licencia.' });
    }
});


// Ruta para obtener todas las licencias (requiere autenticación o ser solo para admin)
app.get('/licenses', async (req, res) => {
    if (maintenanceMode) {
        return res.status(503).json({ success: false, message: 'El servicio está en modo de mantenimiento. Por favor, inténtalo de nuevo más tarde.' });
    }
    try {
        const rows = await getSheetRows(LICENSES_SHEET_NAME);
        if (rows.length === 0) {
            return res.json({ licenses: [] });
        }
        const headers = rows[0];
        const data = rows.slice(1).map(row => {
            let license = {};
            headers.forEach((header, index) => {
                license[header] = row[index] || '';
            });
            return license;
        });
        res.json({ licenses: data });
    } catch (error) {
        console.error('Error al obtener licencias:', error.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor al obtener licencias.' });
    }
});


// Ruta para obtener todos los usuarios (requiere autenticación o ser solo para admin)
app.get('/users', async (req, res) => {
    if (maintenanceMode) {
        return res.status(503).json({ success: false, message: 'El servicio está en modo de mantenimiento. Por favor, inténtalo de nuevo más tarde.' });
    }
    try {
        const rows = await getSheetRows(USERS_SHEET_NAME);
        if (rows.length === 0) {
            return res.json({ users: [] });
        }
        const headers = rows[0];
        const data = rows.slice(1).map(row => {
            let user = {};
            headers.forEach((header, index) => {
                user[header] = row[index] || '';
            });
            return user;
        });
        res.json({ users: data });
    } catch (error) {
        console.error('Error al obtener usuarios:', error.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor al obtener usuarios.' });
    }
});

let maintenanceMode = false; // Estado del modo de mantenimiento, por defecto desactivado

// Endpoint para establecer el modo de mantenimiento
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
initGoogleSheets().then(() => {
    app.listen(port, () => {
        console.log(`Servidor de licencias escuchando en http://localhost:${port}`);
    });
}).catch(error => {
    console.error('Fallo al iniciar el servidor:', error);
    process.exit(1);
});