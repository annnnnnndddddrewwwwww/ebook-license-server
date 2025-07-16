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
let maintenanceMode = false; // Estado inicial del modo de mantenimiento

// --- Configuración de Nodemailer --- // <-- ADD THIS SECTION
const transporter = nodemailer.createTransport({
    service: 'gmail', // Puedes usar 'smtp.mailtrap.io' para pruebas o tu proveedor de correo
    auth: {
        user: process.env.EMAIL_USER,    // Tu correo electrónico (ej. 'tu_correo@gmail.com')
        pass: process.env.EMAIL_PASS    // Tu contraseña de aplicación/token de seguridad
    }
});

// --- Funciones de Google Sheets (asegúrate de que estas funciones existan en tu archivo) ---
// Initialize Google Sheets API
async function initGoogleSheets() {
    try {
        const auth = new google.auth.JWT(
            GOOGLE_SERVICE_ACCOUNT_EMAIL,
            null,
            GOOGLE_PRIVATE_KEY,
            ['https://www.googleapis.com/auth/spreadsheets']
        );
        sheets = google.sheets({ version: 'v4', auth });
        console.log('Conexión con Google Sheets establecida.');

        // Cargar el estado del modo de mantenimiento al iniciar el servidor
        const maintenanceStatus = await getAppConfigValue('maintenanceMode');
        maintenanceMode = maintenanceStatus === 'true'; // Convertir a booleano
        console.log(`Modo de mantenimiento inicial: ${maintenanceMode}`);

    } catch (error) {
        console.error('Error al conectar con Google Sheets:', error.message);
        process.exit(1); // Salir si no se puede conectar a Sheets
    }
}

// Function to read data from a sheet
async function readSheet(sheetName) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: sheetName,
        });
        return response.data.values || [];
    } catch (error) {
        console.error(`Error al leer la hoja ${sheetName}:`, error.message);
        throw error;
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
        return response.data;
    } catch (error) {
        console.error(`Error al añadir fila en la hoja ${sheetName}:`, error.message);
        throw error;
    }
}

// Function to update a row in a sheet by row number (index + 1)
async function updateSheetRow(sheetName, rowIndex, rowData) {
    try {
        const range = `${sheetName}!A${rowIndex + 1}`; // A is the first column, rowIndex is 0-based
        const response = await sheets.spreadsheets.values.update({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: range,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [rowData],
            },
        });
        return response.data;
    } catch (error) {
        console.error(`Error al actualizar fila ${rowIndex + 1} en la hoja ${sheetName}:`, error.message);
        throw error;
    }
}

// Function to update a specific cell in a sheet
async function updateSheetCell(sheetName, cell, value) {
    try {
        const range = `${sheetName}!${cell}`;
        const response = await sheets.spreadsheets.values.update({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: range,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [[value]],
            },
        });
        return response.data;
    } catch (error) {
        console.error(`Error al actualizar celda ${cell} en la hoja ${sheetName}:`, error.message);
        throw error;
    }
}

// Function to get a value from the AppConfig sheet
async function getAppConfigValue(key) {
    try {
        const configData = await readSheet(APP_CONFIG_SHEET_NAME);
        const headerRow = configData[0];
        if (!headerRow) return null; // Sheet is empty

        const keyColumnIndex = headerRow.indexOf('Key');
        const valueColumnIndex = headerRow.indexOf('Value');

        if (keyColumnIndex === -1 || valueColumnIndex === -1) {
            console.warn(`Columnas 'Key' o 'Value' no encontradas en ${APP_CONFIG_SHEET_NAME}.`);
            return null;
        }

        const row = configData.find(r => r[keyColumnIndex] === key);
        return row ? row[valueColumnIndex] : null;
    } catch (error) {
        console.error(`Error al obtener el valor de configuración para ${key}:`, error.message);
        return null;
    }
}

// Function to set a value in the AppConfig sheet
async function setAppConfigValue(key, value) {
    try {
        const configData = await readSheet(APP_CONFIG_SHEET_NAME);
        const headerRow = configData[0];
        let rowIndex = -1;

        if (headerRow) {
            const keyColumnIndex = headerRow.indexOf('Key');
            if (keyColumnIndex !== -1) {
                // Find existing row for the key
                rowIndex = configData.findIndex((row, i) => i > 0 && row[keyColumnIndex] === key);
            }
        }

        if (rowIndex !== -1) {
            // Update existing row
            const actualRowIndex = rowIndex; // rowIndex here is 0-based index of the data, so 1-based in sheet
            const valueCell = `B${actualRowIndex + 1}`; // Assuming 'Value' is in column B
            await updateSheetCell(APP_CONFIG_SHEET_NAME, valueCell, value);
        } else {
            // Append new row if key doesn't exist
            await appendSheetRow(APP_CONFIG_SHEET_NAME, [key, value]);
        }
        console.log(`Configuración '${key}' actualizada a: ${value}`);
    } catch (error) {
        console.error(`Error al establecer el valor de configuración para ${key}:`, error.message);
        throw error;
    }
}


// --- API Endpoints ---

// Endpoint para generar nuevas licencias
app.post('/generate-license', async (req, res) => {
    // ... (Your existing /generate-license code) ...
    if (maintenanceMode) {
        return res.status(503).json({ success: false, message: "El servidor está en modo de mantenimiento." });
    }
    const { count = 1, type = 'standard' } = req.body; // Puedes añadir tipo de licencia si quieres
    const licenses = [];
    const now = new Date().toISOString();

    for (let i = 0; i < count; i++) {
        const newLicense = uuidv4();
        licenses.push([newLicense, 'unused', now, '', '', '', '']); // licenseKey, status, generatedDate, usedBy, usedDate, userEmail, userIP
    }

    try {
        await appendSheetRow(LICENSES_SHEET_NAME, licenses);
        res.json({ success: true, message: `${count} licencias generadas y guardadas.`, licenses: licenses.map(l => l[0]) });
    } catch (error) {
        console.error('Error al generar y guardar licencias:', error.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor al generar licencias.' });
    }
});

// Endpoint para validar y registrar licencias
app.post('/validate-and-register-license', async (req, res) => {
    if (maintenanceMode) {
        return res.status(503).json({ success: false, message: "El servidor está en modo de mantenimiento." });
    }
    const { userName, userEmail, licenseKey } = req.body;
    const userIP = req.ip || req.connection.remoteAddress; // Obtener IP del usuario

    if (!userName || !userEmail || !licenseKey) {
        return res.status(400).json({ success: false, message: 'Faltan nombre, correo o clave de licencia.' });
    }

    try {
        const licenses = await readSheet(LICENSES_SHEET_NAME);
        const licenseHeader = licenses[0];
        const licenseData = licenses.slice(1);

        const keyIndex = licenseHeader.indexOf('licenseKey');
        const statusIndex = licenseHeader.indexOf('status');
        const usedByIndex = licenseHeader.indexOf('usedBy');
        const usedDateIndex = licenseHeader.indexOf('usedDate');
        const userEmailIndex = licenseHeader.indexOf('userEmail');
        const userIPIndex = licenseHeader.indexOf('userIP');

        // Find the license and its row index
        let licenseFound = false;
        let licenseRowIndex = -1;
        let isValidLicense = false; // <-- Initializing isValidLicense here
        let currentLicenseStatus = '';

        for (let i = 0; i < licenseData.length; i++) {
            if (licenseData[i][keyIndex] === licenseKey) {
                licenseFound = true;
                licenseRowIndex = i + 1; // +1 because sheet rows are 1-based and we sliced the header
                currentLicenseStatus = licenseData[i][statusIndex];

                if (currentLicenseStatus === 'unused' || licenseData[i][userEmailIndex] === userEmail) {
                    isValidLicense = true; // License is unused OR it's already used by THIS user
                }
                break;
            }
        }

        if (isValidLicense) { // <-- The 'if (isValidLicense)' block starts here
            // Update license status if it was unused
            if (currentLicenseStatus === 'unused') {
                const updatedLicenseRow = [...licenses[licenseRowIndex]]; // Get current row data
                updatedLicenseRow[statusIndex] = 'used';
                updatedLicenseRow[usedByIndex] = userName;
                updatedLicenseRow[usedDateIndex] = new Date().toISOString();
                updatedLicenseRow[userEmailIndex] = userEmail;
                updatedLicenseRow[userIPIndex] = userIP;
                await updateSheetRow(LICENSES_SHEET_NAME, licenseRowIndex, updatedLicenseRow);
            }

            // Register/Update user data in 'Users' sheet
            const users = await readSheet(USERS_SHEET_NAME);
            const usersHeader = users[0];
            const usersData = users.slice(1);

            const userIdIndex = usersHeader.indexOf('userId');
            const userNameIndex = usersHeader.indexOf('userName');
            const userEmailColIndex = usersHeader.indexOf('userEmail');
            const userIPColIndex = usersHeader.indexOf('userIP');
            const lastAccessDateIndex = usersHeader.indexOf('lastAccessDate');
            const licenseKeyColIndex = usersHeader.indexOf('licenseKey');

            let userFound = false;
            let userRowIndex = -1;

            for (let i = 0; i < usersData.length; i++) {
                if (usersData[i][userEmailColIndex] === userEmail) {
                    userFound = true;
                    userRowIndex = i + 1; // +1 for actual sheet row
                    break;
                }
            }

            if (userFound) {
                // Update existing user
                const updatedUserRow = [...users[userRowIndex]];
                updatedUserRow[userNameIndex] = userName; // Update name in case it changed
                updatedUserRow[userIPColIndex] = userIP;
                updatedUserRow[lastAccessDateIndex] = new Date().toISOString();
                updatedUserRow[licenseKeyColIndex] = licenseKey; // Update license in case it changed
                await updateSheetRow(USERS_SHEET_NAME, userRowIndex, updatedUserRow);
            } else {
                // Register new user
                const newUserId = uuidv4();
                await appendSheetRow(USERS_SHEET_NAME, [
                    newUserId, userName, userEmail, userIP, new Date().toISOString(), licenseKey
                ]);
            }

            // --- Enviar correo de bienvenida ---
            const mailOptions = {
                from: process.env.EMAIL_USER, // Remitente
                to: userEmail, // Correo del usuario que acaba de acceder
                subject: '¡Bienvenido a tu Ebook Exclusivo de Eva Vidal!',
                html: `
                    <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: auto; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden;">
                        <div style="background-color: #4A729E; padding: 30px 20px; text-align: center; color: white;">
                            <h2 style="margin: 0; font-family: 'Poppins', sans-serif; font-size: 28px;">¡Bienvenido/a, ${userName}!</h2>
                            <p style="font-size: 16px; margin-top: 10px;">Tu acceso al Ebook de Nutrición y Bienestar ha sido confirmado.</p>
                        </div>
                        <div style="padding: 30px; color: #444444; line-height: 1.6;">
                            <p>Estamos encantados de que formes parte de nuestra comunidad. Con esta licencia, has desbloqueado contenido exclusivo diseñado para ayudarte en tu camino hacia una vida más saludable.</p>
                            <p>Puedes acceder a tu ebook en cualquier momento desde nuestro portal web. Asegúrate de guardar tu clave de licencia.</p>
                            <p>Si tienes alguna pregunta o necesitas asistencia, no dudes en contactarnos a través de WhatsApp. Estamos aquí para ayudarte.</p>
                            <p style="text-align: center; margin-top: 30px;">
                                <a href="https://wa.me/XXXXXXXXX" style="background-color: #25D366; color: white; padding: 12px 25px; border-radius: 5px; text-decoration: none; font-weight: bold;">Contactar por WhatsApp</a>
                            </p>
                            <p style="font-size: 14px; color: #777; text-align: center; margin-top: 40px;">
                                ¡Gracias por confiar en Eva Vidal!
                            </p>
                        </div>
                        <div style="background-color: #f8f8f8; padding: 20px; text-align: center; font-size: 12px; color: #999;">
                            <p>&copy; ${new Date().getFullYear()} Eva Vidal. Todos los derechos reservados.</p>
                        </div>
                    </div>
                `
            };

            try {
                await transporter.sendMail(mailOptions);
                console.log(`Correo de bienvenida enviado a ${userEmail}`);
            } catch (emailError) {
                console.error(`Error al enviar correo de bienvenida a ${userEmail}:`, emailError);
                // Not critical for access, just log the error
            }

            res.json({
                success: true,
                message: "Acceso concedido al ebook. ¡Bienvenido!",
                userName: userName,
                userEmail: userEmail,
                licenseKey: licenseKey,
                redirectToEbook: true
            });
        } else { // <-- This 'else' block handles invalid licenses
            if (!licenseFound) {
                return res.status(400).json({ success: false, message: 'Clave de licencia no encontrada.' });
            } else if (currentLicenseStatus === 'used') {
                return res.status(400).json({ success: false, message: 'Clave de licencia ya utilizada por otro usuario.' });
            } else {
                return res.status(400).json({ success: false, message: 'Clave de licencia inválida.' });
            }
        }
    } catch (error) {
        console.error('Error en la validación/registro de licencia:', error.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

// Endpoint para ver todas las licencias (admin)
app.get('/licenses', async (req, res) => {
    // ... (Your existing /licenses code) ...
    if (maintenanceMode) {
        return res.status(503).json({ success: false, message: "El servidor está en modo de mantenimiento." });
    }
    try {
        const licenses = await readSheet(LICENSES_SHEET_NAME);
        res.json({ success: true, licenses });
    } catch (error) {
        console.error('Error al obtener licencias:', error.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

// Endpoint para ver todos los usuarios (admin)
app.get('/users', async (req, res) => {
    // ... (Your existing /users code) ...
    if (maintenanceMode) {
        return res.status(503).json({ success: false, message: "El servidor está en modo de mantenimiento." });
    }
    try {
        const users = await readSheet(USERS_SHEET_NAME);
        res.json({ success: true, users });
    } catch (error) {
        console.error('Error al obtener usuarios:', error.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

// Endpoint para establecer el modo de mantenimiento
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
        console.log(`Servidor escuchando en http://localhost:${port}`);
    });
});