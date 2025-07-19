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
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Variable para el modo de mantenimiento
let maintenanceMode = false; // Inicializado a false por defecto

// --- FUNCIONES DE ASISTENCIA PARA GOOGLE SHEETS ---

// Obtener datos de una hoja (rows, cols)
async function getSheetData(sheetName) {
    // Verificar si googleSheets está inicializado antes de usarlo
    if (!googleSheets) {
        throw new Error('Google Sheets API no inicializada. (getSheetData)');
    }
    const response = await googleSheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: sheetName,
    });
    return response.data.values;
}

// Añadir una nueva fila a una hoja
async function appendSheetRow(sheetName, rowData) {
    if (!googleSheets) {
        throw new Error('Google Sheets API no inicializada. (appendSheetRow)');
    }
    const response = await googleSheets.spreadsheets.values.append({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: sheetName,
        valueInputOption: 'USER_ENTERED',
        resource: {
            values: [rowData],
        },
    });
    return response.data;
}

// Actualizar una fila existente en una hoja
async function updateSheetRow(sheetName, rowNumber, data) {
    if (!googleSheets) {
        throw new Error('Google Sheets API no inicializada. (updateSheetRow)');
    }
    const response = await googleSheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${sheetName}!A${rowNumber}`, // Asume que la actualización es desde la columna A
        valueInputOption: 'USER_ENTERED',
        resource: {
            values: [data],
        },
    });
    return response.data;
}

// --- FUNCIONES DE CONFIGURACIÓN DE LA APP (desde AppConfig sheet) ---

// Obtener un valor de configuración
async function getAppConfigValue(settingName) {
    try {
        const appConfigData = await getSheetData(APP_CONFIG_SHEET_NAME);
        if (appConfigData && appConfigData.length > 1) { // Asume que la primera fila son cabeceras
            const headerRow = appConfigData[0];
            const settingNameColIndex = headerRow.indexOf('SettingName');
            const settingValueColIndex = headerRow.indexOf('SettingValue');

            if (settingNameColIndex === -1 || settingValueColIndex === -1) {
                console.error("Columnas 'SettingName' o 'SettingValue' no encontradas en la hoja AppConfig.");
                return null;
            }

            for (let i = 1; i < appConfigData.length; i++) {
                const row = appConfigData[i];
                if (row[settingNameColIndex] === settingName) {
                    return row[settingValueColIndex];
                }
            }
        }
        return null; // Configuración no encontrada
    } catch (error) {
        console.error(`Error al leer la configuración '${settingName}' de Google Sheets:`, error.message);
        console.error(error.stack); // Log del stack trace
        throw error; // Propagar el error
    }
}

// Establecer/Actualizar un valor de configuración
async function setAppConfigValue(settingName, settingValue) {
    try {
        const appConfigData = await getSheetData(APP_CONFIG_SHEET_NAME);
        let rowIndex = -1;
        let headerRow = [];

        if (appConfigData && appConfigData.length > 0) {
            headerRow = appConfigData[0];
            const settingNameColIndex = headerRow.indexOf('SettingName');

            if (settingNameColIndex === -1) {
                console.error("Columna 'SettingName' no encontrada en la hoja AppConfig. No se puede actualizar.");
                return;
            }

            for (let i = 1; i < appConfigData.length; i++) {
                if (appConfigData[i][settingNameColIndex] === settingName) {
                    rowIndex = i + 1; // +1 porque las filas de Sheets son 1-indexed
                    break;
                }
            }
        }

        const currentTimestamp = new Date().toISOString();
        const dataToSave = [settingName, settingValue, currentTimestamp];

        if (rowIndex !== -1) {
            // Actualizar fila existente
            console.log(`Actualizando fila ${rowIndex} para SettingName='${settingName}' en AppConfig.`);
            const rowValues = [...appConfigData[rowIndex - 1]]; // Copia la fila existente
            const settingValueColIndex = headerRow.indexOf('SettingValue');
            const timestampColIndex = headerRow.indexOf('LastUpdated');

            if (settingValueColIndex !== -1) rowValues[settingValueColIndex] = settingValue;
            if (timestampColIndex !== -1) rowValues[timestampColIndex] = currentTimestamp;

            await updateSheetRow(APP_CONFIG_SHEET_NAME, rowIndex, rowValues);
            console.log(`Configuración '${settingName}' actualizada en Google Sheets: ${settingValue}`);
        } else {
            // Añadir nueva fila
            console.log(`No se encontró la fila con SettingName='${settingName}' para actualizar en AppConfig. Se intentará añadir.`);
            let newRow = [];
            // Si hay cabeceras, asegura que el nuevo row coincida con la estructura
            if (headerRow.length > 0) {
                newRow[headerRow.indexOf('SettingName')] = settingName;
                newRow[headerRow.indexOf('SettingValue')] = settingValue;
                if (headerRow.indexOf('LastUpdated') !== -1) newRow[headerRow.indexOf('LastUpdated')] = currentTimestamp;
            } else {
                newRow = [settingName, settingValue, currentTimestamp]; // Asume orden si no hay cabeceras
            }
            await appendSheetRow(APP_CONFIG_SHEET_NAME, newRow);
            console.log(`Configuración '${settingName}' guardada en Google Sheets: ${settingValue}`);
        }
    } catch (error) {
        console.error(`Error al guardar la configuración '${settingName}' en Google Sheets:`, error.message);
        console.error(error.stack); // Log del stack trace
        throw error; // Propagar el error
    }
}

// Cargar o establecer el modo de mantenimiento
async function loadMaintenanceModeFromSheet() {
    try {
        let currentMode = await getAppConfigValue('maintenanceMode');
        if (currentMode === null) {
            // Si no existe, establecerlo por defecto a 'false' en la hoja
            await setAppConfigValue('maintenanceMode', 'false');
            currentMode = 'false';
        }
        maintenanceMode = (currentMode === 'true');
        console.log(`Modo de mantenimiento inicializado a ${maintenanceMode} en Google Sheets.`);
    } catch (error) {
        console.error('Error al cargar/establecer modo de mantenimiento desde Google Sheets:', error.message);
        console.error(error.stack); // Log del stack trace
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
// Middleware para el modo de mantenimiento
app.use((req, res, next) => {
    // Excluye las rutas de verificación de estado o configuración de mantenimiento
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
                <title>Mantenimiento</title>
                <style>
                    body { font-family: sans-serif; text-align: center; padding-top: 50px; }
                    h1 { color: #333; }
                    p { color: #666; }
                </style>
            </head>
            <body>
                <h1>¡En Mantenimiento!</h1>
                <p>Lo sentimos, estamos realizando tareas de mantenimiento. Volveremos pronto.</p>
            </body>
            </html>
        `);
    }
    next();
});

// --- ENDPOINT: Validar Licencia y Registrar IP ---
app.post('/validate-license', async (req, res) => {
    // ... (Tu código existente para validate-license)
    const { licenseKey } = req.body;
    const clientIp = req.ip; // Express ya normaliza esto

    if (!licenseKey) {
        return res.status(400).json({ valid: false, message: "Clave de licencia requerida." });
    }

    try {
        const licenses = await getSheetData(LICENSES_SHEET_NAME);
        if (!licenses || licenses.length === 0) {
            console.warn("La hoja de licencias está vacía o no existe.");
            return res.status(500).json({ valid: false, message: "No se encontraron licencias." });
        }

        const headerRow = licenses[0];
        const licenseColIndex = headerRow.indexOf('LicenseKey');
        const activatedColIndex = headerRow.indexOf('Activated');
        const maxIpsColIndex = headerRow.indexOf('MaxUniqueIPs');
        const ipsColIndex = headerRow.indexOf('UniqueIPs');

        if (licenseColIndex === -1 || activatedColIndex === -1 || maxIpsColIndex === -1 || ipsColIndex === -1) {
            console.error("Columnas requeridas no encontradas en la hoja 'Licenses'.");
            return res.status(500).json({ valid: false, message: "Error en la configuración de la hoja de licencias." });
        }

        let licenseFound = false;
        for (let i = 1; i < licenses.length; i++) {
            const row = licenses[i];
            const incomingLicenseKey = licenseKey.trim();
            const sheetLicenseKey = (row[licenseColIndex] || '').trim();

            if (sheetLicenseKey === incomingLicenseKey) {
                licenseFound = true;
                const isActivated = row[activatedColIndex] === 'TRUE';
                const maxUniqueIpsNum = parseInt(row[maxIpsColIndex] || '1', 10);
                let uniqueIps = (row[ipsColIndex] || '').split(',').filter(ip => ip !== '');

                // Si la IP actual ya está en la lista, la licencia es válida
                if (uniqueIps.includes(clientIp)) {
                    console.log(`Licencia '${incomingLicenseKey}' ya activada para esta IP: ${clientIp}`);
                    return res.json({ valid: true, message: "Licencia válida y activada para esta IP." });
                }

                // Si la licencia aún no está activada o no ha alcanzado el límite de IPs
                if (!isActivated || uniqueIps.length < maxUniqueIpsNum) {
                    if (!isActivated) {
                        // Marca como activada si es la primera IP
                        row[activatedColIndex] = 'TRUE';
                    }
                    uniqueIps.push(clientIp);
                    row[ipsColIndex] = uniqueIps.join(',');

                    // Actualiza la fila en Google Sheets
                    await updateSheetRow(LICENSES_SHEET_NAME, i + 1, row); // i + 1 es el número de fila real
                    console.log(`Licencia '${incomingLicenseKey}' activada para nueva IP: ${clientIp}`);
                    return res.json({ valid: true, message: "Licencia válida y activada para esta IP." });
                } else {
                    console.log(`Licencia '${incomingLicenseKey}' ha alcanzado su límite de ${maxUniqueIpsNum} IPs únicas. Intento de uso por IP: ${clientIp}`);
                    return res.status(403).json({ valid: false, message: `Esta licencia ya ha sido activada por su número máximo de ${maxUniqueIpsNum} IPs diferentes.` });
                }
            }
        }
        if (!licenseFound) {
            console.log(`Licencia no encontrada: ${licenseKey}`);
            return res.status(404).json({ valid: false, message: "Licencia no encontrada." });
        }
    } catch (error) {
        console.error("Error durante la validación/registro de licencia en Sheets:", error);
        return res.status(500).json({ valid: false, message: "Error interno del servidor." });
    }
});


// --- ENDPOINT: Recopilar datos de usuario ---
app.post('/collect-user-data', async (req, res) => {
    const { name, email, licenseKey } = req.body;
    const clientIp = req.ip;

    if (!name || !email || !licenseKey) {
        return res.status(400).json({ success: false, message: "Nombre, email y clave de licencia son requeridos." });
    }

    try {
        const timestamp = new Date().toISOString();
        const userData = [name, email, licenseKey, clientIp, timestamp];
        await appendSheetRow(USERS_SHEET_NAME, userData);
        console.log(`Datos de usuario recopilados: ${email}, ${licenseKey}`);

        // Opcional: Enviar email de confirmación
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Confirmación de Acceso a Ebook de Licencias',
            html: `
                <p>Hola ${name},</p>
                <p>Gracias por registrarte para acceder al Ebook de Licencias con la clave <strong>${licenseKey}</strong>.</p>
                <p>Puedes acceder a tu ebook haciendo clic aquí: <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}">Acceder a tu Ebook</a></p>
                <p>¡Disfruta!</p>
            `
        };
        await transporter.sendMail(mailOptions);
        console.log(`Email de confirmación enviado a ${email}`);

        return res.status(200).json({ success: true, message: "Datos recopilados y email enviado." });
    } catch (error) {
        console.error("Error al recopilar datos de usuario o enviar email:", error);
        return res.status(500).json({ success: false, message: "Error interno del servidor al procesar los datos." });
    }
});

// --- NUEVO ENDPOINT: Establecer Modo de Mantenimiento ---
app.post('/set-maintenance-mode', async (req, res) => {
    const { mode } = req.body; // 'true' o 'false'
    // Implementa aquí alguna lógica de autenticación/autorización para este endpoint
    // por ejemplo, solo permitir desde una IP específica o con una clave de API.
    if (!process.env.ADMIN_API_KEY || req.headers['x-api-key'] !== process.env.ADMIN_API_KEY) {
        return res.status(403).json({ success: false, message: "Acceso no autorizado." });
    }

    if (mode === 'true' || mode === 'false') {
        try {
            await setAppConfigValue('maintenanceMode', mode);
            maintenanceMode = (mode === 'true'); // Actualiza la variable en memoria
            console.log(`Modo de mantenimiento actualizado a: ${maintenanceMode}`);
            return res.json({ success: true, message: `Modo de mantenimiento establecido a ${maintenanceMode}.` });
        } catch (error) {
            console.error("Error al establecer el modo de mantenimiento:", error);
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

        // Estructura de la fila para Google Sheets: LicenseKey, Activated, MaxUniqueIPs, UniqueIPs (vacío), GeneratedAt
        const licenseData = [
            newLicenseKey,
            'FALSE', // Por defecto no activada
            numMaxIps.toString(), // Convertir a string para la hoja de cálculo
            '',      // UniqueIPs vacío inicialmente
            timestamp
        ];

        await appendSheetRow(LICENSES_SHEET_NAME, licenseData);
        console.log(`Licencia generada y guardada: ${newLicenseKey} con ${numMaxIps} IPs máximas.`);

        return res.status(200).json({ success: true, message: "Licencia generada correctamente.", licenseKey: newLicenseKey });
    } catch (error) {
        console.error("Error al generar y guardar la licencia:", error);
        return res.status(500).json({ success: false, message: "Error interno del servidor al generar la licencia." });
    }
});

// Ruta de bienvenida (opcional, para verificar que el servidor está corriendo)
app.get('/', (req, res) => {
    res.send('Servidor de licencias funcionando correctamente.');
});


// --- FUNCIÓN PRINCIPAL PARA INICIAR EL SERVIDOR ---
// ESTA SECCIÓN DEBE IR AL FINAL DE TU ARCHIVO, DESPUÉS DE TODAS LAS DEFINICIONES DE RUTAS Y MIDDLEWARE.
// Es una función asíncrona para asegurar que la autenticación con Google Sheets
// se complete ANTES de que el servidor comience a escuchar solicitudes.
async function startServer() {
    try {
        console.log('Iniciando autenticación y configuración inicial de Google Sheets...');
        // Espera a que la autenticación de Google Sheets se complete.
        // authenticateGoogleSheets() se llama AQUÍ Y SOLO AQUÍ.
        await authenticateGoogleSheets();
        console.log('Google Sheets: Configuración inicial completa. Iniciando servidor Express...');

        // Inicia el servidor Express.
        // app.listen() se llama AQUÍ Y SOLO AQUÍ.
        app.listen(port, '0.0.0.0', () => { // Enlaza explícitamente a 0.0.0.0 para compatibilidad en entornos de hosting
            console.log(`Servidor de licencias escuchando en http://0.0.0.0:${port}`);
        });
    } catch (error) {
        // Captura cualquier error crítico durante la configuración inicial
        console.error('ERROR CRÍTICO: El servidor no pudo iniciarse debido a un fallo en la configuración inicial:', error);
        process.exit(1); // Sale del proceso si hay un fallo crítico en el inicio
    }
}

// --- LLAMADA FINAL: INICIA LA APLICACIÓN ---
// ESTA DEBE SER LA ÚNICA LÍNEA EN TODO EL ARCHIVO QUE LLAME A startServer().
startServer();