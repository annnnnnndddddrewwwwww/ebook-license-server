// server.js
require('dotenv').config(); // Carga las variables de entorno desde .env (solo para desarrollo local)
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const { google } = require('googleapis'); // Importa googleapis
const nodemailer = require('nodemailer'); // <--- NUEVO: Importa Nodemailer

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
let maintenanceMode = false; // Estado del modo de mantenimiento en memoria
let appConfigHeaders = []; // Encabezados de la hoja AppConfig

let transporter; // <--- NUEVO: Variable global para el transporter de Nodemailer

// --- NUEVO: Función para configurar el transporter de correo ---
async function createMailTransporter() {
    try {
        transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: parseInt(process.env.EMAIL_PORT, 10), // Asegura que el puerto sea un entero
            secure: process.env.EMAIL_PORT == 465, // true para 465 (SSL), false para otros puertos (TLS)
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });
        await transporter.verify(); // Verifica la configuración del transporter
        console.log("Servicio de correo listo para enviar mensajes.");
    } catch (error) {
        console.error("Error al configurar el servicio de correo:", error);
        transporter = null; // Establece a null si la configuración falla
    }
}

// --- NUEVO: Función para enviar correo de bienvenida ---
async function sendWelcomeEmail(userEmail, userName, licenseKey) {
    if (!transporter) {
        console.error("No se pudo enviar el correo de bienvenida: el servicio de correo no está configurado o falló al iniciar.");
        return;
    }

    const mailOptions = {
        from: `Ebook EVA <${process.env.EMAIL_USER}>`, // <--- REEMPLAZA CON TU EMAIL VERIFICADO
        to: userEmail,
        subject: '¡Bienvenido a tu Ebook Interactivo EVA!',
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <h2 style="color: #4A729E;">¡Hola, ${userName}!</h2>
                <p>¡Gracias por registrarte y activar tu licencia para el Ebook Interactivo EVA!</p>
                <p>Tu clave de licencia es: <strong>${licenseKey}</strong></p>
                <p>Con esta licencia, tienes acceso a todo el contenido exclusivo.</p>
                <p>Esperamos que disfrutes de tu aprendizaje.</p>
                <p style="margin-top: 20px; font-size: 0.9em; color: #777;">Saludos cordiales,</p>
                <p style="font-size: 0.9em; color: #777;">El Equipo de Ebook EVA</p>
                <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="font-size: 0.8em; color: #999;">Este es un correo automático, por favor no respondas a este mensaje.</p>
            </div>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Correo de bienvenida enviado a ${userEmail}`);
    } catch (error) {
        console.error(`Error al enviar correo de bienvenida a ${userEmail}:`, error);
    }
}


// --- Función para autenticar con Google Sheets (existente, pero modificada) ---
async function authenticateGoogleSheets() {
    try {
        const auth = new google.auth.JWT(
            GOOGLE_SERVICE_ACCOUNT_EMAIL,
            null,
            GOOGLE_PRIVATE_KEY,
            ['https://www.googleapis.com/auth/spreadsheets']
        );

        await auth.authorize();
        sheets = google.sheets({ version: 'v4', auth });
        console.log('Autenticación con Google Sheets exitosa!');

        // Cargar estado de mantenimiento y configurar AppConfig headers al inicio
        await initializeAppConfig();
        
        // <--- NUEVO: Inicializar el servicio de correo después de la autenticación de Google Sheets
        await createMailTransporter(); 
        
    } catch (error) {
        console.error('Error al autenticar con Google Sheets:', error);
        process.exit(1); // Salir si la autenticación falla, ya que es crítica
    }
}

// --- Función para inicializar AppConfig (existente) ---
async function initializeAppConfig() {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: APP_CONFIG_SHEET_NAME,
        });
        const rows = response.data.values;
        if (rows && rows.length > 0) {
            appConfigHeaders = rows[0]; // La primera fila son los encabezados
            const maintenanceModeRow = rows.find(row => row[appConfigHeaders.indexOf('Key')] === 'maintenanceMode');
            if (maintenanceModeRow) {
                const value = maintenanceModeRow[appConfigHeaders.indexOf('Value')];
                maintenanceMode = (value === 'true'); // Convertir a booleano
                console.log(`Estado inicial del modo de mantenimiento cargado: ${maintenanceMode}`);
            }
        } else {
            // Si la hoja está vacía, crear encabezados
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `${APP_CONFIG_SHEET_NAME}!A1`,
                valueInputOption: 'RAW',
                resource: {
                    values: [['Key', 'Value']]
                }
            });
            appConfigHeaders = ['Key', 'Value'];
            console.log('Hoja AppConfig inicializada con encabezados.');
        }
    } catch (error) {
        console.error('Error al inicializar la configuración de la aplicación desde Google Sheets:', error);
        // Continuar, pero el modo de mantenimiento por defecto será false
    }
}

// --- Función para obtener un valor de configuración (existente) ---
async function getAppConfigValue(key) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: APP_CONFIG_SHEET_NAME,
        });
        const rows = response.data.values;
        if (rows && rows.length > 0) {
            const headers = rows[0];
            const keyIndex = headers.indexOf('Key');
            const valueIndex = headers.indexOf('Value');
            if (keyIndex !== -1 && valueIndex !== -1) {
                const row = rows.find(r => r[keyIndex] === key);
                return row ? row[valueIndex] : null;
            }
        }
        return null;
    } catch (error) {
        console.error(`Error al obtener el valor de configuración para ${key}:`, error);
        return null;
    }
}

// --- Función para establecer un valor de configuración (existente) ---
async function setAppConfigValue(key, value) {
    try {
        // Asegurarse de que los encabezados estén cargados
        if (appConfigHeaders.length === 0) {
            await initializeAppConfig();
        }

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: APP_CONFIG_SHEET_NAME,
        });
        const rows = response.data.values;
        let rowIndex = -1;

        if (rows) {
            rowIndex = rows.findIndex(row => row[appConfigHeaders.indexOf('Key')] === key);
        }

        if (rowIndex !== -1) {
            // Actualizar fila existente
            const range = `${APP_CONFIG_SHEET_NAME}!B${rowIndex + 1}`; // Columna 'Value' de la fila
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: range,
                valueInputOption: 'RAW',
                resource: {
                    values: [[value]],
                },
            });
            console.log(`Configuración '${key}' actualizada a '${value}'.`);
        } else {
            // Añadir nueva fila
            await sheets.spreadsheets.values.append({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: APP_CONFIG_SHEET_NAME,
                valueInputOption: 'RAW',
                resource: {
                    values: [[key, value]],
                },
            });
            console.log(`Configuración '${key}' añadida con valor '${value}'.`);
        }
    } catch (error) {
        console.error(`Error al establecer el valor de configuración para ${key}:`, error);
    }
}

// --- Función para añadir fila a Google Sheets (existente) ---
async function appendSheetRow(sheetName, rowData) {
    try {
        const headersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetName}!1:1`,
        });
        const headers = headersResponse.data.values[0];

        const values = headers.map(header => rowData[header] !== undefined ? rowData[header] : '');

        await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: sheetName,
            valueInputOption: 'RAW',
            resource: {
                values: [values],
            },
        });
        console.log(`Fila añadida a la hoja '${sheetName}'.`);
    } catch (error) {
        console.error(`Error al añadir fila a la hoja '${sheetName}':`, error);
        throw error;
    }
}

// --- NUEVO: Función para obtener una fila por valor de columna ---
// Esto es necesario para verificar si un usuario ya existe y si ya se le envió el correo.
async function getRowByColumnValue(sheetName, columnName, value) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: sheetName,
        });
        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return null; // No rows found
        }
        const headers = rows[0];
        const columnIndex = headers.indexOf(columnName);
        if (columnIndex === -1) {
            console.warn(`Columna '${columnName}' no encontrada en la hoja '${sheetName}'.`);
            return null;
        }

        for (let i = 1; i < rows.length; i++) { // Start from 1 to skip headers
            if (rows[i][columnIndex] === value) {
                const rowData = {};
                headers.forEach((header, index) => {
                    rowData[header] = rows[i][index];
                });
                return { rowData, rowIndex: i + 1 }; // Return data and 1-based index
            }
        }
        return null; // No matching row found
    } catch (error) {
        console.error(`Error al obtener fila por columna en la hoja '${sheetName}':`, error);
        return null;
    }
}


// --- ENDPOINT: Generar Licencia (existente) ---
app.post('/generate-license', async (req, res) => {
    const { maxUniqueIps } = req.body;
    if (!maxUniqueIps) {
        return res.status(400).json({ success: false, message: 'Falta el parámetro maxUniqueIps.' });
    }

    if (maintenanceMode) {
        return res.status(503).json({ success: false, message: 'El servicio está en modo de mantenimiento. Inténtalo de nuevo más tarde.' });
    }

    const licenseKey = uuidv4(); // Genera una UUID v4

    const licenseData = {
        licenseKey: licenseKey,
        maxUniqueIps: maxUniqueIps,
        activatedIps: '', // Vacío al inicio
        lastUsed: '', // Vacío al inicio
        isValid: 'TRUE', // Por defecto es válida
        createdAt: new Date().toISOString()
    };

    try {
        await appendSheetRow(LICENSES_SHEET_NAME, licenseData);
        res.json({ success: true, message: 'Licencia generada y guardada con éxito.', license: licenseKey });
    } catch (error) {
        console.error("Error al generar licencia y guardar en Sheets:", error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al generar la licencia.' });
    }
});

// --- ENDPOINT: Invalidar Licencia (existente) ---
app.post('/invalidate-license', async (req, res) => {
    const { license } = req.body;
    if (!license) {
        return res.status(400).json({ success: false, message: 'Falta la clave de licencia.' });
    }

    if (maintenanceMode) {
        return res.status(503).json({ success: false, message: 'El servicio está en modo de mantenimiento. Inténtalo de nuevo más tarde.' });
    }

    try {
        const licenseResult = await getRowByColumnValue(LICENSES_SHEET_NAME, 'licenseKey', license);
        if (!licenseResult) {
            return res.status(404).json({ success: false, message: 'Licencia no encontrada.' });
        }

        const licenseRowIndex = licenseResult.rowIndex;

        // Obtener los encabezados de la hoja de licencias
        const licenseHeadersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${LICENSES_SHEET_NAME}!1:1`,
        });
        const licenseHeaders = licenseHeadersResponse.data.values[0];

        const isValidColumnIndex = licenseHeaders.indexOf('isValid');
        if (isValidColumnIndex === -1) {
            return res.status(500).json({ success: false, message: 'Columna "isValid" no encontrada en la hoja de licencias.' });
        }

        // Actualizar solo la columna 'isValid'
        const range = `${LICENSES_SHEET_NAME}!${String.fromCharCode(65 + isValidColumnIndex)}${licenseRowIndex}`; // Convertir índice a letra de columna
        await sheets.spreadsheets.values.update({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: range,
            valueInputOption: 'RAW',
            resource: {
                values: [['FALSE']],
            },
        });

        res.json({ success: true, message: `Licencia ${license} invalidada con éxito.` });
    } catch (error) {
        console.error("Error al invalidar licencia:", error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al invalidar la licencia.' });
    }
});

// --- MODIFICADO: ENDPOINT para Validar y Registrar Licencia ---
app.post('/validate-and-register-license', async (req, res) => {
    const { license, userName, userEmail, userIp } = req.body;

    if (!license || !userName || !userEmail || !userIp) {
        return res.status(400).json({ success: false, message: 'Faltan parámetros: licencia, userName, userEmail o userIp.' });
    }

    if (maintenanceMode) {
        return res.status(503).json({ success: false, message: 'El servicio está en modo de mantenimiento. Inténtalo de nuevo más tarde.' });
    }

    try {
        // 1. Buscar la licencia
        const licenseResult = await getRowByColumnValue(LICENSES_SHEET_NAME, 'licenseKey', license);
        if (!licenseResult) {
            return res.status(404).json({ success: false, message: 'Licencia no encontrada.' });
        }

        const licenseData = licenseResult.rowData;
        const licenseRowIndex = licenseResult.rowIndex;

        if (licenseData.isValid !== 'TRUE') { // Las booleanas de Sheets son strings 'TRUE'/'FALSE'
            return res.status(403).json({ success: false, message: 'La licencia no es válida o ha sido invalidada.' });
        }

        // 2. Gestionar IPs activadas
        let activatedIps = licenseData.activatedIps ? licenseData.activatedIps.split(',') : [];
        const maxUniqueIps = parseInt(licenseData.maxUniqueIps, 10);

        const isIpAlreadyActivated = activatedIps.includes(userIp);

        if (!isIpAlreadyActivated) {
            if (activatedIps.length >= maxUniqueIps) {
                return res.status(403).json({ success: false, message: 'Límite de IPs únicas alcanzado para esta licencia.' });
            }
            activatedIps.push(userIp);
        }

        const newActivatedIpsString = activatedIps.join(',');
        const currentTimestamp = new Date().toISOString();

        // Actualizar la licencia en Google Sheets (solo si hubo cambios en IPs o lastUsed)
        // Obtener los encabezados de la hoja de licencias
        const licenseHeadersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${LICENSES_SHEET_NAME}!1:1`,
        });
        const licenseHeaders = licenseHeadersResponse.data.values[0];

        // Mapear los datos de la licencia a los índices de columna
        const licenseUpdateValues = licenseHeaders.map(header => {
            if (header === 'activatedIps') return newActivatedIpsString;
            if (header === 'lastUsed') return currentTimestamp;
            return licenseData[header] || ''; // Mantener valor existente o vacío
        });

        await sheets.spreadsheets.values.update({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${LICENSES_SHEET_NAME}!A${licenseRowIndex}`, // Actualiza desde columna A
            valueInputOption: 'RAW',
            resource: {
                values: [licenseUpdateValues],
            },
        });
        console.log(`Licencia ${license} actualizada en Google Sheets.`);


        // 3. Registrar o actualizar usuario
        const userResult = await getRowByColumnValue(USERS_SHEET_NAME, 'userEmail', userEmail);
        let isFirstRegistration = false;

        if (userResult) {
            // Usuario existente
            const existingUserData = userResult.rowData;
            const userRowIndex = userResult.rowIndex;

            // Determinar si es la primera vez que este usuario (por email) accede o se registra
            // Si 'firstAccess' está vacío o no definido, se considera primera vez.
            if (!existingUserData.firstAccess || existingUserData.firstAccess === '') {
                isFirstRegistration = true;
            }
            
            // Obtener los encabezados de la hoja de usuarios
            const userHeadersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `${USERS_SHEET_NAME}!1:1`,
            });
            const userHeaders = userHeadersResponse.data.values[0];

            // Mapear los datos del usuario a los índices de columna para la actualización
            const userUpdateValues = userHeaders.map(header => {
                switch (header) {
                    case 'userName': return userName;
                    case 'licenseKey': return license;
                    case 'lastAccess': return currentTimestamp;
                    case 'firstAccess': return existingUserData.firstAccess || currentTimestamp; // Mantener si ya existe
                    default: return existingUserData[header] || ''; // Mantener otros campos existentes
                }
            });

            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `${USERS_SHEET_NAME}!A${userRowIndex}`,
                valueInputOption: 'RAW',
                resource: {
                    values: [userUpdateValues],
                },
            });
            console.log(`Usuario ${userEmail} actualizado en Google Sheets.`);

        } else {
            // Nuevo usuario
            isFirstRegistration = true; // Definitivamente es un primer registro
            const userHeadersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `${USERS_SHEET_NAME}!1:1`,
            });
            const userHeaders = userHeadersResponse.data.values[0];

            const newUserRow = userHeaders.map(header => {
                switch (header) {
                    case 'userEmail': return userEmail;
                    case 'userName': return userName;
                    case 'licenseKey': return license;
                    case 'firstAccess': return currentTimestamp;
                    case 'lastAccess': return currentTimestamp;
                    default: return '';
                }
            });

            await appendSheetRow(USERS_SHEET_NAME, newUserRow);
            console.log(`Nuevo usuario ${userEmail} registrado en Google Sheets.`);
        }

        // <--- NUEVO: Enviar correo de bienvenida SOLO SI es el primer registro para este usuario/licencia
        if (isFirstRegistration) {
            await sendWelcomeEmail(userEmail, userName, license);
        }

        res.json({ success: true, message: 'Licencia validada y usuario registrado con éxito.' });

    } catch (error) {
        console.error('Error en /validate-and-register-license:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});


// --- ENDPOINT: Obtener todas las licencias (existente) ---
app.get('/licenses', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: LICENSES_SHEET_NAME,
        });
        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return res.json([]);
        }

        const headers = rows[0];
        const licenses = rows.slice(1).map(row => {
            const license = {};
            headers.forEach((header, index) => {
                let value = row[index];
                if (header === 'maxUniqueIps') {
                    license[header] = parseInt(value, 10);
                } else if (header === 'isValid') {
                    license[header] = value === 'TRUE';
                } else if (header === 'activatedIps') {
                    license[header] = value ? value.split(',') : [];
                } else {
                    license[header] = value;
                }
            });
            return license;
        });
        res.json(licenses);
    } catch (error) {
        console.error("Error al obtener licencias de Google Sheets:", error);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

// --- ENDPOINT: Obtener todos los usuarios (existente) ---
app.get('/users', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: USERS_SHEET_NAME,
        });
        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return res.json([]);
        }

        const headers = rows[0];
        const users = rows.slice(1).map(row => {
            const user = {};
            headers.forEach((header, index) => {
                user[header] = row[index];
            });
            return user;
        });
        res.json(users);
    } catch (error) {
        console.error("Error al obtener usuarios de Google Sheets:", error);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

// --- ENDPOINT: Activar/Desactivar Modo de Mantenimiento (existente) ---
app.post('/set-maintenance-mode', async (req, res) => {
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

// --- NUEVO ENDPOINT: Obtener Estado de Modo de Mantenimiento (existente) ---
app.get('/get-maintenance-status', (req, res) => {
    res.json({ maintenanceMode: maintenanceMode }); // Retorna el estado actual en memoria (que está sincronizado con la hoja)
});


// Ruta de bienvenida (opcional, para verificar que el servidor está corriendo)
app.get('/', (req, res) => {
    res.send('Servidor de licencias de Ebook funcionando con Google Sheets. Usa /generate-license para generar, /validate-and-register-license para validar, /licenses para ver todas las licencias y /users para ver los datos de usuario.');
});

// Iniciar el servidor
app.listen(port, () => {
    console.log(`Servidor escuchando en http://localhost:${port}`);
    authenticateGoogleSheets(); // Llama a la autenticación al iniciar el servidor
});