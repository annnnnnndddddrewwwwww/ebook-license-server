// server.js
require('dotenv').config(); // Carga las variables de entorno desde .env (solo para desarrollo local)
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const { google } = require('googleapis');
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
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

const LICENSES_SHEET_NAME = 'Licenses';
const USERS_SHEET_NAME = 'Users';
const APP_CONFIG_SHEET_NAME = 'AppConfig';

let sheets;
let maintenanceMode = false;

// --- Configuración de Nodemailer ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

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
        console.log('Conexión a Google Sheets establecida.');

        const storedMaintenanceMode = await getAppConfigValue('maintenanceMode');
        if (storedMaintenanceMode !== null) {
            maintenanceMode = storedMaintenanceMode === 'true';
            console.log(`Modo de mantenimiento inicial: ${maintenanceMode}`);
        } else {
            await setAppConfigValue('maintenanceMode', 'false');
            maintenanceMode = false;
        }

    } catch (error) {
        console.error('Error al conectar con Google Sheets:', error.message);
        process.exit(1);
    }
}

// --- Funciones auxiliares para interactuar con Google Sheets ---

async function getAppConfigValue(key) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${APP_CONFIG_SHEET_NAME}!A:B`,
        });
        const rows = response.data.values;
        if (rows) {
            for (const row of rows) {
                if (row[0] === key) {
                    return row[1];
                }
            }
        }
        return null;
    } catch (error) {
        console.error(`Error al obtener el valor de configuración para ${key}:`, error.message);
        return null;
    }
}

async function setAppConfigValue(key, value) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${APP_CONFIG_SHEET_NAME}!A:B`,
        });
        const rows = response.data.values || [];
        let rowIndex = -1;
        for (let i = 0; i < rows.length; i++) {
            if (rows[i][0] === key) {
                rowIndex = i;
                break;
            }
        }

        if (rowIndex !== -1) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `${APP_CONFIG_SHEET_NAME}!B${rowIndex + 1}`,
                valueInputOption: 'RAW',
                requestBody: {
                    values: [[value]],
                },
            });
        } else {
            await sheets.spreadsheets.values.append({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `${APP_CONFIG_SHEET_NAME}!A:B`,
                valueInputOption: 'RAW',
                requestBody: {
                    values: [[key, value]],
                },
            });
        }
        console.log(`Configuración '${key}' guardada como '${value}'.`);
    } catch (error) {
        console.error(`Error al establecer el valor de configuración para ${key}:`, error.message);
    }
}


// --- ENDPOINTS DE LA API ---

// Endpoint para generar una nueva licencia
app.post('/generate-license', async (req, res) => {
    if (maintenanceMode) {
        return res.status(503).json({ success: false, message: 'El servidor está en modo de mantenimiento. No se pueden generar nuevas licencias.' });
    }

    const newLicenseKey = uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase();
    const createdAt = new Date().toISOString();

    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${LICENSES_SHEET_NAME}!A:C`,
            valueInputOption: 'RAW',
            requestBody: {
                values: [
                    [newLicenseKey, 'FALSE', createdAt]
                ],
            },
        });
        res.json({ success: true, licenseKey: newLicenseKey });
    } catch (error) {
        console.error('Error al generar y guardar la licencia:', error.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor al generar la licencia.' });
    }
});

// Endpoint para validar una licencia y registrar al usuario
app.post('/validate-and-register-license', async (req, res) => {
    const { licenseKey } = req.body;

    // *** MODIFICACIÓN AQUÍ: SE ELIMINA LA VALIDACIÓN EXPLÍCITA DE CLAVE VACÍA EN EL BACKEND ***
    // Si licenseKey es nula o vacía, la lógica de búsqueda de licencia abajo simplemente no la encontrará,
    // y devolverá "Licencia inválida." lo cual es un comportamiento deseado.
    // if (!licenseKey) {
    //     return res.status(400).json({ success: false, message: 'La clave de licencia proporcionada está vacía.' });
    // }
    // ******************************************************************************************

    if (maintenanceMode) {
        console.log(`Validación de licencia '${licenseKey}' en modo mantenimiento.`);
    }

    try {
        // 1. Buscar la licencia en la hoja 'Licenses'
        const licenseResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${LICENSES_SHEET_NAME}!A:B`,
        });
        const licenses = licenseResponse.data.values;

        let licenseFound = false;
        let licenseUsed = false;
        let rowIndex = -1;

        if (licenses) {
            for (let i = 0; i < licenses.length; i++) {
                // Asegúrate de comparar solo si row[0] existe para evitar errores con filas vacías
                if (licenses[i][0] && licenses[i][0] === licenseKey) {
                    licenseFound = true;
                    // Asegúrate de que licenses[i][1] exista antes de comparar
                    licenseUsed = (licenses[i][1] === 'TRUE');
                    rowIndex = i;
                    break;
                }
            }
        }

        if (!licenseFound) {
            return res.status(401).json({ success: false, message: 'Licencia inválida.' });
        }

        if (licenseUsed) {
            return res.status(403).json({ success: false, message: 'Licencia ya utilizada o activa en otro dispositivo.' });
        }

        // 2. Si la licencia es válida y no usada, marcarla como usada
        if (rowIndex !== -1) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `${LICENSES_SHEET_NAME}!B${rowIndex + 1}`,
                valueInputOption: 'RAW',
                requestBody: {
                    values: [['TRUE']],
                },
            });
            console.log(`Licencia ${licenseKey} marcada como usada.`);
        }

        // 3. Respuesta de éxito
        res.json({ success: true, message: 'Licencia validada correctamente. Acceso concedido.' });

    } catch (error) {
        console.error('Error al validar la licencia:', error.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor al validar la licencia.' });
    }
});


// Endpoint para obtener todas las licencias (solo para administración)
app.get('/licenses', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${LICENSES_SHEET_NAME}!A:C`,
        });
        const licenses = response.data.values;
        if (licenses && licenses.length > 0) {
            const formattedLicenses = licenses.slice(1).map(row => ({
                licenseKey: row[0],
                isUsed: row[1] === 'TRUE',
                createdAt: row[2]
            }));
            res.json({ success: true, licenses: formattedLicenses });
        } else {
            res.json({ success: true, message: 'No hay licencias registradas.' });
        }
    } catch (error) {
        console.error('Error al obtener licencias:', error.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor al obtener licencias.' });
    }
});

// Endpoint para obtener todos los usuarios registrados (solo para administración)
app.get('/users', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${USERS_SHEET_NAME}!A:D`,
        });
        const users = response.data.values;
        if (users && users.length > 0) {
            const formattedUsers = users.slice(1).map(row => ({
                userId: row[0],
                userName: row[1],
                userEmail: row[2],
                registeredAt: row[3]
            }));
            res.json({ success: true, users: formattedUsers });
        } else {
            res.json({ success: true, message: 'No hay usuarios registrados.' });
        }
    } catch (error) {
        console.error('Error al obtener usuarios:', error.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor al obtener usuarios.' });
    }
});

// Endpoint para establecer y obtener el modo de mantenimiento
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

app.get('/get-maintenance-status', (req, res) => {
    res.json({ maintenanceMode: maintenanceMode });
});


// Endpoint: Send Welcome Email on Login (Modificado para solo texto)
app.post('/send-welcome-on-login', async (req, res) => {
    const { userName, userEmail } = req.body;

    if (!userName || !userEmail) {
        return res.status(400).json({ success: false, message: 'Nombre de usuario y correo electrónico son requeridos para enviar el email de bienvenida.' });
    }

    try {
        const registeredAt = new Date().toISOString();
        const userId = uuidv4(); // Genera un ID único para el usuario
        await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${USERS_SHEET_NAME}!A:D`, // Columnas: ID_Usuario, Nombre, Email, Fecha_Registro
            valueInputOption: 'RAW',
            requestBody: {
                values: [
                    [userId, userName, userEmail, registeredAt]
                ],
            },
        });
        console.log(`Usuario ${userName} (${userEmail}) registrado en Google Sheets.`);
    } catch (sheetError) {
        console.error('Error al registrar el usuario en Google Sheets:', sheetError.message);
    }

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: userEmail,
        subject: '¡Bienvenido/a a tu Ebook!',
        html: `
            <p>Hola ${userName},</p>
            <p>¡Te damos la bienvenida a tu Ebook! Esperamos que disfrutes mucho de la lectura.</p>
            <p>Gracias por unirte a nuestra comunidad.</p>
            <br>
            <p>Saludos cordiales,</p>
            <p>El equipo de [Tu Nombre/Empresa]</p>
            <p><small>Este es un correo automático, por favor no respondas a este mensaje.</small></p>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Correo de bienvenida enviado a ${userEmail}`);
        res.json({ success: true, message: 'Correo de bienvenida enviado.' });
    } catch (error) {
        console.error('Error al enviar el correo de bienvenida:', error);
        res.status(500).json({ success: false, message: 'Fallo al enviar el correo de bienvenida.' });
    }
});

// Ruta de bienvenida (opcional, para verificar que el servidor está corriendo)
app.get('/', (req, res) => {
    res.send('Servidor de licencias de Ebook funcionando con Google Sheets.');
});

// Iniciar el servidor
initGoogleSheets().then(() => {
    app.listen(port, () => {
        console.log(`Servidor de licencias escuchando en http://localhost:${port}`);
    });
});