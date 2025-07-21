// server.js
require('dotenv').config();
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({
    origin: '*',
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

// --- Función para enviar correo de bienvenida ---
async function sendWelcomeEmail(userName, userEmail, licenseKey) {
    try {
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: userEmail,
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
        throw error;
    }
}

// --- Inicialización de Google Sheets y carga de configuración ---
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

        const maintenanceModeValue = await getAppConfigValue('maintenanceMode');
        maintenanceMode = maintenanceModeValue === 'true';
        console.log(`Modo de mantenimiento inicial: ${maintenanceMode}`);

        console.log('Google Sheets API inicializado con éxito.');
    } catch (error) {
        console.error('Error al inicializar Google Sheets API:', error);
        process.exit(1);
    }
}

// --- Helpers para Configuración de la App ---
async function getAppConfigValue(key) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${APP_CONFIG_SHEET_NAME}!A:B`,
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
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `${APP_CONFIG_SHEET_NAME}!B${rowToUpdate + 1}`,
                valueInputOption: 'RAW',
                resource: {
                    values: [[value]],
                },
            });
        } else {
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

// --- Middleware para obtener la IP del cliente ---
// Esto intentará obtener la IP real del cliente detrás de un proxy/load balancer
app.use((req, res, next) => {
    req.clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    // En entornos locales o sin proxy, remoteAddress es suficiente.
    // x-forwarded-for es para Cloudflare, Render, etc.
    if (req.clientIp && req.clientIp.includes(',')) {
        req.clientIp = req.clientIp.split(',')[0].trim(); // Toma la primera IP si hay varias
    }
    next();
});

// --- Endpoint para generar una licencia (solo con MaxIPs) ---
app.post('/generate-license', async (req, res) => {
    if (maintenanceMode) {
        return res.status(503).json({ success: false, message: 'El servidor está en modo de mantenimiento. Inténtalo de nuevo más tarde.' });
    }

    const { maxIPs } = req.body; // Solo esperamos maxIPs

    if (maxIPs === undefined || typeof maxIPs !== 'number' || maxIPs < 1) {
        return res.status(400).json({ success: false, message: 'Se requiere un número válido de IPs máximas (maxIPs >= 1).' });
    }

    try {
        const licenseKey = uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase();

        const now = new Date();
        const timestamp = now.toISOString();
        const expiryDate = new Date(now.setFullYear(now.getFullYear() + 1)).toISOString();

        // Guardar en la pestaña 'Licenses': LicenseKey, MaxIPs, UsedIPs (vacío), ExpiryDate
        await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${LICENSES_SHEET_NAME}!A:D`, // A:D para las 4 columnas
            valueInputOption: 'RAW',
            resource: {
                values: [[licenseKey, maxIPs, '', expiryDate]] // UsedIPs comienza vacío
            }
        });

        // Opcional: Si aún quieres mantener un registro de "usuarios" (sin email en la generación)
        // Puedes guardar una entrada genérica o usar solo la licencia aquí
        // await sheets.spreadsheets.values.append({
        //     spreadsheetId: GOOGLE_SHEET_ID,
        //     range: `${USERS_SHEET_NAME}!A:D`,
        //     valueInputOption: 'RAW',
        //     resource: {
        //         values: [[`LicenseUser_${licenseKey}`, 'N/A', timestamp, 'false']]
        //     }
        // });

        console.log(`Licencia generada: ${licenseKey} con ${maxIPs} IPs.`);

        res.json({ success: true, message: 'Licencia generada con éxito. Por favor, inicia sesión para acceder.', licenseKey: licenseKey, maxIPs: maxIPs });

    } catch (error) {
        console.error('Error al generar o registrar la licencia:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al generar la licencia.' });
    }
});


// --- Endpoint para validar licencia y registrar IP ---
app.post('/validate-and-register-license', async (req, res) => {
    if (maintenanceMode) {
        return res.status(503).json({ success: false, message: 'El servidor está en modo de mantenimiento. Inténtalo de nuevo más tarde.' });
    }

    const { licenseKey } = req.body;
    const clientIp = req.clientIp; // Obtener la IP del cliente del middleware

    if (!licenseKey) {
        return res.status(400).json({ success: false, message: 'Se requiere la clave de licencia.' });
    }
    if (!clientIp) {
        return res.status(500).json({ success: false, message: 'No se pudo determinar la dirección IP del cliente.' });
    }

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${LICENSES_SHEET_NAME}!A:D`, // Leer LicenseKey, MaxIPs, UsedIPs, ExpiryDate
        });

        const licenses = response.data.values;
        let licenseFound = false;
        let isValid = false;
        let licenseRowIndex = -1;
        let storedMaxIPs = 0;
        let storedUsedIPs = []; // Array para las IPs usadas

        if (licenses) {
            // Saltamos la primera fila si es de encabezados. Si no hay encabezados, ajusta el +1.
            for (let i = 0; i < licenses.length; i++) {
                const row = licenses[i];
                // Asegurarse de que la fila tiene suficientes columnas
                if (row.length < 4) continue;

                const [storedLicenseKey, maxIPsStr, usedIPsStr, storedExpiryDate] = row;

                if (storedLicenseKey === licenseKey.toUpperCase()) {
                    licenseFound = true;
                    licenseRowIndex = i + 1; // Índice de fila en Google Sheets (base 1)
                    storedMaxIPs = parseInt(maxIPsStr, 10);
                    storedUsedIPs = usedIPsStr ? usedIPsStr.split(',') : []; // IPs separadas por coma

                    const expiryDate = new Date(storedExpiryDate);
                    if (expiryDate <= new Date()) {
                        // Licencia expirada
                        break;
                    }

                    // Verificar límite de IPs
                    if (storedUsedIPs.includes(clientIp)) {
                        isValid = true; // La IP ya está registrada para esta licencia
                    } else if (storedUsedIPs.length < storedMaxIPs) {
                        // IP nueva y hay slots disponibles
                        storedUsedIPs.push(clientIp);
                        isValid = true;

                        // Actualizar la hoja de Google Sheets con la nueva IP
                        const updatedUsedIPs = storedUsedIPs.join(',');
                        await sheets.spreadsheets.values.update({
                            spreadsheetId: GOOGLE_SHEET_ID,
                            range: `${LICENSES_SHEET_NAME}!C${licenseRowIndex}`, // Columna C (UsedIPs)
                            valueInputOption: 'RAW',
                            resource: {
                                values: [[updatedUsedIPs]],
                            },
                        });
                        console.log(`IP ${clientIp} registrada para licencia ${licenseKey}. IPs restantes: ${storedMaxIPs - storedUsedIPs.length}`);
                    } else {
                        // Límite de IPs alcanzado
                        res.status(403).json({ success: false, message: `Límite de ${storedMaxIPs} IPs alcanzado para esta licencia. Si crees que esto es un error, contacta al soporte.` });
                        return; // Salir de la función aquí
                    }
                    break;
                }
            }
        }

        if (licenseFound && isValid) {
            res.json({ success: true, message: 'Licencia válida. Acceso concedido.' });
        } else if (licenseFound && !isValid) {
            res.status(403).json({ success: false, message: 'La licencia ha expirado. Por favor, contacta al soporte.' });
        } else {
            res.status(404).json({ success: false, message: 'Licencia no encontrada o inválida.' });
        }

    } catch (error) {
        console.error('Error al validar la licencia o registrar IP:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al validar la licencia.' });
    }
});


// --- Endpoint para enviar correo de bienvenida al "inicio de sesión" ---
// Este endpoint se llama desde el frontend DESPUÉS de una validación exitosa de licencia.
// Sigue requiriendo userName y userEmail para el contenido del correo y el registro de usuario.
app.post('/send-welcome-on-login', async (req, res) => {
    const { userEmail, userName, licenseKey } = req.body; // Aún necesitamos estos para el correo

    if (!userEmail || !userName || !licenseKey) {
        return res.status(400).json({ success: false, message: 'Se requieren correo, nombre de usuario y clave de licencia para enviar el email de bienvenida.' });
    }

    try {
        // Verificar si el usuario ya existe en la hoja 'Users'
        let userRowIndex = -1;
        let welcomeEmailSent = 'false';
        let users = [];

        try {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `${USERS_SHEET_NAME}!A:D`, // Asumiendo UserName, UserEmail, Timestamp, WelcomeEmailSent
            });
            users = response.data.values || [];
        } catch (readError) {
            console.warn(`No se pudo leer la hoja de Users, asumiendo vacío: ${readError.message}`);
            users = []; // Si la hoja no existe o está vacía, se comporta como si no hubiera usuarios.
        }

        if (users.length > 0) {
            for (let i = 0; i < users.length; i++) {
                if (users[i][1] === userEmail) { // userEmail está en la columna B (índice 1)
                    userRowIndex = i + 1; // Fila en Google Sheets (base 1)
                    welcomeEmailSent = users[i][3] || 'false';
                    break;
                }
            }
        }

        if (welcomeEmailSent === 'true') {
            console.log(`Correo de bienvenida ya enviado a ${userEmail}. No se reenvía.`);
            return res.json({ success: true, message: 'Correo de bienvenida ya enviado.' });
        } else {
            // Si el usuario no existe en la hoja 'Users' o el correo no ha sido enviado
            if (userRowIndex === -1) {
                // Registrar al nuevo "usuario" si no existe
                const now = new Date();
                const timestamp = now.toISOString();
                await sheets.spreadsheets.values.append({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: `${USERS_SHEET_NAME}!A:D`,
                    valueInputOption: 'RAW',
                    resource: {
                        values: [[userName, userEmail, timestamp, 'false']] // Inicialmente 'false'
                    }
                });
                console.log(`Usuario ${userName} (${userEmail}) registrado en la hoja de Users.`);
                // Volver a leer para obtener el nuevo índice de fila si se acaba de añadir
                const updatedUsersResponse = await sheets.spreadsheets.values.get({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: `${USERS_SHEET_NAME}!A:D`,
                });
                const updatedUsers = updatedUsersResponse.data.values || [];
                // Encontrar el índice de la fila del usuario recién añadido
                for (let i = 0; i < updatedUsers.length; i++) {
                    if (updatedUsers[i][1] === userEmail) {
                        userRowIndex = i + 1;
                        break;
                    }
                }
            }

            await sendWelcomeEmail(userName, userEmail, licenseKey);

            // Actualiza el estado en Google Sheets a 'true'
            const rangeToUpdate = `${USERS_SHEET_NAME}!D${userRowIndex}`;
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


// --- Endpoint para obtener todas las licencias (para administración) ---
app.get('/licenses', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${LICENSES_SHEET_NAME}!A:D`, // A:D para las 4 columnas
        });
        const licenses = response.data.values;
        if (licenses && licenses.length > 0) {
            const data = licenses.slice(1); // Ignorar encabezados
            res.json({ success: true, licenses: data.map(row => ({
                licenseKey: row[0],
                maxIPs: parseInt(row[1], 10),
                usedIPs: row[2] ? row[2].split(',') : [], // Convertir string a array
                expiresAt: row[3]
            })) });
        } else {
            res.json({ success: true, licenses: [], message: 'No hay licencias registradas.' });
        }
    } catch (error) {
        console.error('Error al obtener licencias:', error.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor al obtener licencias.' });
    }
});

// --- Endpoint para obtener todos los usuarios (para administración) ---
// Este endpoint aún muestra userName y userEmail si la hoja Users se sigue usando.
app.get('/users', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${USERS_SHEET_NAME}!A:D`,
        });
        const users = response.data.values;
        if (users && users.length > 0) {
            const data = users.slice(1);
            res.json({ success: true, users: data.map(row => ({
                userName: row[0],
                userEmail: row[1],
                registeredAt: row[2],
                welcomeEmailSent: row[3] || 'false'
            })) });
        } else {
            res.json({ success: true, users: [], message: 'No hay usuarios registrados.' });
        }
    } catch (error) {
        console.error('Error al obtener usuarios:', error.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor al obtener usuarios.' });
    }
});

// --- Endpoint para establecer y obtener el modo de mantenimiento ---
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

// Ruta de bienvenida
app.get('/', (req, res) => {
    res.send('Servidor de licencias de Ebook funcionando con Google Sheets.');
});

// Iniciar el servidor
initGoogleSheets().then(() => {
    app.listen(port, () => {
        console.log(`Servidor de licencias escuchando en http://localhost:${port}`);
    });
}).catch(error => {
    console.error('Fallo al iniciar el servidor debido a error de inicialización de Google Sheets:', error);
});