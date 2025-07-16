// server.js
require('dotenv').config(); // Carga las variables de entorno desde .env (solo para desarrollo local)
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const { google } = require('googleapis'); // Importa googleapis

const nodemailer = require('nodemailer'); // <--- AÑADIDO: Importa Nodemailer

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

// --- Configuración de Nodemailer (para enviar emails) ---
const TRANSPORTER_EMAIL = process.env.TRANSPORTER_EMAIL;
const TRANSPORTER_PASSWORD = process.env.TRANSPORTER_PASSWORD;

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: TRANSPORTER_EMAIL,
        pass: TRANSPORTER_PASSWORD,
    },
});

// Inicializar Google Sheets API
async function initializeGoogleSheets() {
    try {
        const auth = new google.auth.JWT(
            GOOGLE_SERVICE_ACCOUNT_EMAIL,
            null,
            GOOGLE_PRIVATE_KEY,
            ['https://www.googleapis.com/auth/spreadsheets']
        );
        await auth.authorize();
        sheets = google.sheets({ version: 'v4', auth });
        console.log('Conexión a Google Sheets API establecida.');

        // Cargar el estado inicial del modo de mantenimiento
        maintenanceMode = await getAppConfigValue('maintenanceMode') === 'true';
        console.log(`Estado inicial del modo de mantenimiento: ${maintenanceMode}`);

    } catch (error) {
        console.error('Error al conectar con Google Sheets API:', error.message);
        // Salir de la aplicación o deshabilitar funcionalidades dependientes si la conexión falla
        process.exit(1); // Considera si quieres que la app se caiga o siga sin sheets
    }
}

// Función para obtener un valor de la hoja AppConfig
async function getAppConfigValue(key) {
    if (!sheets) return null; // Asegúrate de que sheets está inicializado
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${APP_CONFIG_SHEET_NAME}!A:B`, // Asume clave en Col A, valor en Col B
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
        console.error(`Error al obtener el valor de AppConfig para ${key}:`, error.message);
        return null;
    }
}

// Función para establecer un valor en la hoja AppConfig
async function setAppConfigValue(key, value) {
    if (!sheets) return false;
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${APP_CONFIG_SHEET_NAME}!A:A`,
        });
        const rows = response.data.values || [];
        let rowIndex = -1;

        for (let i = 0; i < rows.length; i++) {
            if (rows[i][0] === key) {
                rowIndex = i + 1; // Fila encontrada (1-indexed)
                break;
            }
        }

        if (rowIndex !== -1) {
            // Si la clave existe, actualizar el valor
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `${APP_CONFIG_SHEET_NAME}!B${rowIndex}`,
                valueInputOption: 'RAW',
                resource: {
                    values: [[value]],
                },
            });
            console.log(`Valor de ${key} actualizado en AppConfig.`);
        } else {
            // Si la clave no existe, añadir una nueva fila
            await sheets.spreadsheets.values.append({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `${APP_CONFIG_SHEET_NAME}!A:B`,
                valueInputOption: 'RAW',
                resource: {
                    values: [[key, value]],
                },
            });
            console.log(`Nueva clave ${key} añadida a AppConfig.`);
        }
        return true;
    } catch (error) {
        console.error(`Error al establecer el valor de AppConfig para ${key}:`, error.message);
        return false;
    }
}


// Middleware para verificar el modo de mantenimiento
app.use((req, res, next) => {
    // Permitir acceso a endpoints de estado de mantenimiento y la ruta raíz incluso en modo de mantenimiento
    if (maintenanceMode && req.path !== '/get-maintenance-status' && req.path !== '/') {
        return res.status(503).json({ success: false, message: 'El servidor está en modo de mantenimiento. Por favor, inténtalo de nuevo más tarde.' });
    }
    next();
});

// Función para encontrar una licencia por su clave
async function findLicenseByKey(licenseKey) {
    if (!sheets) return null; // Asegúrate de que sheets está inicializado
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${LICENSES_SHEET_NAME}!A:E`, // Obtener columnas de A a E
        });
        const rows = response.data.values;
        if (rows) {
            // Saltar la primera fila si son encabezados
            for (let i = 1; i < rows.length; i++) {
                if (rows[i][0] === licenseKey) { // Columna A para la clave de licencia
                    return {
                        licenseKey: rows[i][0],
                        maxUniqueIps: parseInt(rows[i][1], 10), // Columna B para máximo de IPs
                        activatedIps: rows[i][2] ? rows[i][2].split(',') : [], // Columna C para IPs activadas
                        expirationDate: rows[i][3], // Columna D para fecha de expiración
                        ebookUrl: rows[i][4] || process.env.DEFAULT_EBOOK_URL // Columna E para URL del ebook, o URL por defecto
                    };
                }
            }
        }
        return null;
    } catch (error) {
        console.error('Error al buscar licencia por clave:', error.message);
        throw new Error('Error interno al buscar licencia.');
    }
}

// Función para actualizar una licencia en la hoja de cálculo
async function updateLicense(licenseData) {
    if (!sheets) throw new Error("Servicio de Google Sheets no disponible.");
    try {
        // Primero, encontrar la fila de la licencia
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${LICENSES_SHEET_NAME}!A:A`, // Solo necesitamos la columna de claves para encontrar la fila
        });
        const rows = response.data.values;
        let rowIndex = -1;

        if (rows) {
            for (let i = 0; i < rows.length; i++) {
                if (rows[i][0] === licenseData.licenseKey) {
                    rowIndex = i + 1; // Las filas de la API son 1-indexadas
                    break;
                }
            }
        }

        if (rowIndex === -1) {
            throw new Error('Licencia no encontrada para actualizar.');
        }

        // Prepara los valores para actualizar la fila
        const values = [
            [
                licenseData.licenseKey,
                licenseData.maxUniqueIps,
                licenseData.activatedIps.join(','),
                licenseData.expirationDate,
                licenseData.ebookUrl || '' // Asegúrate de que no es undefined
            ]
        ];

        await sheets.spreadsheets.values.update({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${LICENSES_SHEET_NAME}!A${rowIndex}:E${rowIndex}`, // Rango específico de la fila
            valueInputOption: 'RAW', // Los datos se introducirán tal cual
            resource: {
                values: values,
            },
        });
        console.log(`Licencia ${licenseData.licenseKey} actualizada.`);
    } catch (error) {
        console.error('Error al actualizar licencia:', error.message);
        throw new Error('Error interno al actualizar licencia.');
    }
}

// Función para añadir/actualizar datos del usuario
async function addUserData(userName, userEmail, licenseKey, ipAddress) {
    if (!sheets) throw new Error("Servicio de Google Sheets no disponible.");
    const now = new Date().toISOString();
    let rowIndex = -1;

    try {
        // Buscar si el usuario ya existe por email
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${USERS_SHEET_NAME}!B:B`, // Columna de emails
        });
        const rows = response.data.values;
        if (rows) {
            for (let i = 1; i < rows.length; i++) { // Ignorar encabezado
                if (rows[i] && rows[i][0] === userEmail) { // Asegura que la fila no está vacía y compara el primer elemento
                    rowIndex = i + 1; // Fila encontrada
                    break;
                }
            }
        }

        if (rowIndex !== -1) {
            // Si el usuario existe, actualizar su última IP, licencia y fecha/hora de acceso
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `${USERS_SHEET_NAME}!C${rowIndex}:E${rowIndex}`, // Columnas LastIP, License, LastAccess
                valueInputOption: 'RAW',
                resource: {
                    values: [[ipAddress, licenseKey, now]],
                },
            });
            console.log(`Datos de usuario actualizados para ${userEmail}.`);
        } else {
            // Si el usuario no existe, añadir nueva fila
            await sheets.spreadsheets.values.append({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `${USERS_SHEET_NAME}!A:E`,
                valueInputOption: 'RAW',
                resource: {
                    values: [[userName, userEmail, ipAddress, licenseKey, now]],
                },
            });
            console.log(`Nuevo usuario registrado: ${userName} (${userEmail}).`);
        }
    } catch (error) {
        console.error('Error al añadir/actualizar datos del usuario:', error.message);
        throw new Error('Error interno al registrar datos del usuario.');
    }
}


// Función para enviar el email de bienvenida
async function sendWelcomeEmail(toEmail, userName) {
    const mailOptions = {
        from: `"Equipo Eva Vidal" <${TRANSPORTER_EMAIL}>`, // Remitente (tu correo de Gmail o noreply)
        to: toEmail, // Destinatario
        subject: '¡Bienvenido a tu Ebook exclusivo de Eva Vidal!', // Asunto
        html: `
            <div style="font-family: 'Poppins', sans-serif; max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08); overflow: hidden; border: 1px solid #e0e0e0;">
                <div style="background-color: #4A729E; padding: 20px; text-align: center; border-bottom: 5px solid #375F8A;">
                    <img src="https://i.ibb.co/jZgFyd0r" alt="Eva Vidal" style="max-width: 200px; height: auto;">
                </div>
                <div style="padding: 30px;">
                    <h2 style="color: #375F8A; font-size: 24px; margin-bottom: 20px; text-align: center;">¡Hola, ${userName}!</h2>
                    <p style="font-size: 16px; line-height: 1.6; color: #555555; margin-bottom: 15px;">
                        ¡Estamos encantados de darte la bienvenida a nuestro contenido exclusivo!
                        Gracias por adquirir tu licencia.
                    </p>
                    <p style="font-size: 16px; line-height: 1.6; color: #555555; margin-bottom: 25px;">
                        Puedes acceder a tu Ebook haciendo clic en el siguiente botón:
                    </p>
                    <div style="text-align: center; margin-bottom: 30px;">
                        <a href="https://tudominio.com/acceso-ebook"
                           style="background-color: #28a745; color: #ffffff; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-size: 18px; font-weight: bold; display: inline-block;">
                           Acceder a mi Ebook
                        </a>
                    </div>
                    <p style="font-size: 14px; color: #888888; text-align: center; margin-top: 20px;">
                        Si tienes alguna pregunta o necesitas ayuda, no dudes en contactarnos.
                    </p>
                    <p style="font-size: 14px; color: #888888; text-align: center;">
                        Saludos,<br>
                        El Equipo de Eva Vidal
                    </p>
                </div>
                <div style="background-color: #f8f8f8; padding: 15px; text-align: center; font-size: 12px; color: #aaaaaa; border-top: 1px solid #e0e0e0;">
                    Este es un correo automático, por favor no respondas a este mensaje.
                </div>
            </div>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
    } catch (error) {
        console.error('Error al enviar el correo de bienvenida:', error);
        throw error;
    }
}


// --- ENDPOINT: Generar nueva licencia ---
app.post('/generate-license', async (req, res) => {
    if (!sheets) return res.status(503).json({ success: false, message: "Servicio de Google Sheets no disponible." });
    if (maintenanceMode) return res.status(503).json({ success: false, message: 'El servidor está en modo de mantenimiento.' });

    const { maxUniqueIps, expirationDays, customEbookUrl } = req.body;

    if (!maxUniqueIps || isNaN(maxUniqueIps) || maxUniqueIps <= 0) {
        return res.status(400).json({ success: false, message: "Número máximo de IPs único es requerido y debe ser un número positivo." });
    }

    const licenseKey = uuidv4(); // Genera una UUID para la licencia

    let expirationDate = 'Nunca';
    if (expirationDays && !isNaN(expirationDays) && expirationDays > 0) {
        const date = new Date();
        date.setDate(date.getDate() + parseInt(expirationDays, 10));
        expirationDate = date.toISOString().split('T')[0]; // Formato YYYY-MM-DD
    }

    const ebookUrlToUse = customEbookUrl || process.env.DEFAULT_EBOOK_URL;
    if (!ebookUrlToUse) {
        return res.status(500).json({ success: false, message: "URL del ebook no especificada ni URL por defecto configurada." });
    }

    try {
        const values = [
            [licenseKey, maxUniqueIps, '', expirationDate, ebookUrlToUse] // IPs activadas inicialmente vacías
        ];

        await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${LICENSES_SHEET_NAME}!A:E`, // Rango donde añadir los datos
            valueInputOption: 'RAW', // Los datos se introducirán tal cual
            resource: {
                values: values,
            },
        });

        res.json({ success: true, licenseKey: licenseKey, maxUniqueIps: maxUniqueIps, expirationDate: expirationDate, ebookUrl: ebookUrlToUse });
    } catch (error) {
        console.error('Error al generar licencia:', error.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor al generar licencia.' });
    }
});

// --- ENDPOINT: Validar y Registrar Licencia ---
app.post('/validate-and-register-license', async (req, res) => {
    if (!sheets) return res.status(503).json({ success: false, message: "Servicio de Google Sheets no disponible." });
    if (maintenanceMode) return res.status(503).json({ success: false, message: 'El servidor está en modo de mantenimiento.' });

    const { license: incomingLicenseKey, userName, userEmail } = req.body;
    const clientIp = req.ip; // Obtener la IP del cliente

    if (!incomingLicenseKey) {
        return res.status(400).json({ valid: false, message: 'Clave de licencia no proporcionada.' });
    }

    try {
        const licenseData = await findLicenseByKey(incomingLicenseKey);

        if (!licenseData) {
            return res.status(401).json({ valid: false, message: 'Licencia inválida o no encontrada.' });
        }

        // Verificar fecha de expiración
        if (licenseData.expirationDate !== 'Nunca') {
            const today = new Date();
            const expiration = new Date(licenseData.expirationDate);
            if (today > expiration) {
                return res.status(401).json({ valid: false, message: 'La licencia ha expirado.' });
            }
        }

        const maxUniqueIpsNum = parseInt(licenseData.maxUniqueIps, 10);
        let activatedIpsArray = licenseData.activatedIps;

        // Comprobar si la IP actual ya está en la lista de IPs activadas
        if (activatedIpsArray.includes(clientIp)) {
            // AÑADIDO: Si la IP ya está registrada, solo actualiza los datos del usuario (fecha de último acceso)
            if (userName && userEmail) {
                await addUserData(userName, userEmail, incomingLicenseKey, clientIp);
                console.log(`Usuario ${userEmail} (IP ${clientIp}) re-accediendo con licencia ${incomingLicenseKey}.`);
            } else {
                console.warn(`IP ${clientIp} ya registrada para licencia ${incomingLicenseKey}. Faltan userName o userEmail para actualizar datos de usuario.`);
            }
            // FIN AÑADIDO

            return res.json({ valid: true, message: "Licencia válida y ya activada para esta IP.", ebookUrl: licenseData.ebookUrl });
        } else { // Nueva IP para esta licencia o primera activación
            if (activatedIpsArray.length < maxUniqueIpsNum) {
                activatedIpsArray.push(clientIp); // Añadir la nueva IP
                licenseData.activatedIps = activatedIpsArray;

                await updateLicense(licenseData); // Guardar los cambios en la hoja

                // AÑADIDO: Lógica para añadir/actualizar usuario y ENVIAR EMAIL
                console.log(`DEBUG: userName=${userName}, userEmail=${userEmail} recibidos para email.`);

                if (userName && userEmail) {
                    await addUserData(userName, userEmail, incomingLicenseKey, clientIp); // Registra/Actualiza usuario
                    console.log(`Datos de usuario actualizados para ${userEmail}. Intentando enviar email de bienvenida...`);
                    try {
                        await sendWelcomeEmail(userEmail, userName); // Llama a la función de envío de correo
                        console.log(`Email de bienvenida enviado con éxito a: ${userEmail}`);
                    } catch (emailError) {
                        console.error('Error al enviar email de bienvenida:', emailError);
                    }
                } else {
                    console.warn('No se pudo registrar usuario ni enviar correo de bienvenida: Faltan userName o userEmail en la solicitud.');
                }
                // FIN AÑADIDO

                res.json({ valid: true, message: "Licencia válida y activada para esta IP.", ebookUrl: licenseData.ebookUrl });

            } else {
                return res.status(403).json({ valid: false, message: `Límite de ${maxUniqueIpsNum} IPs únicas alcanzado para esta licencia.` });
            }
        }
    } catch (error) {
        console.error('Error en /validate-and-register-license:', error.message);
        res.status(500).json({ valid: false, message: 'Error interno del servidor al validar licencia.' });
    }
});


// --- ENDPOINT: Invalidar Licencia ---
app.post('/invalidate-license', async (req, res) => {
    if (!sheets) return res.status(503).json({ success: false, message: "Servicio de Google Sheets no disponible." });
    if (maintenanceMode) return res.status(503).json({ success: false, message: 'El servidor está en modo de mantenimiento.' });

    const { license: licenseKeyToInvalidate } = req.body;

    if (!licenseKeyToInvalidate) {
        return res.status(400).json({ success: false, message: 'Clave de licencia no proporcionada.' });
    }

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${LICENSES_SHEET_NAME}!A:A`, // Solo necesitamos la columna de claves
        });
        const rows = response.data.values;
        let rowIndex = -1;

        if (rows) {
            for (let i = 0; i < rows.length; i++) {
                if (rows[i][0] === licenseKeyToInvalidate) {
                    rowIndex = i + 1; // Las filas de la API son 1-indexadas
                    break;
                }
            }
        }

        if (rowIndex === -1) {
            return res.status(404).json({ success: false, message: 'Licencia no encontrada.' });
        }

        // Para invalidar, podemos eliminar la fila o marcarla.
        // Aquí la eliminaremos para simplicidad.
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: GOOGLE_SHEET_ID,
            resource: {
                requests: [{
                    deleteDimension: {
                        range: {
                            sheetId: (await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, ranges: LICENSES_SHEET_NAME })).data.sheets[0].properties.sheetId,
                            dimension: 'ROWS',
                            startIndex: rowIndex - 1, // API es 0-indexada para startIndex
                            endIndex: rowIndex
                        }
                    }
                }]
            }
        });

        res.json({ success: true, message: `Licencia ${licenseKeyToInvalidate} invalidada y eliminada.` });

    } catch (error) {
        console.error('Error al invalidar licencia:', error.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor al invalidar licencia.' });
    }
});

// --- ENDPOINT: Obtener todas las licencias ---
app.get('/licenses', async (req, res) => {
    if (!sheets) return res.status(503).json({ success: false, message: "Servicio de Google Sheets no disponible." });
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${LICENSES_SHEET_NAME}!A:E`, // Obtener todas las columnas relevantes
        });
        const rows = response.data.values;
        if (rows && rows.length > 1) { // Si hay encabezados y datos
            // Mapea las filas a objetos para una respuesta más limpia
            const licenses = rows.slice(1).map(row => ({
                licenseKey: row[0],
                maxUniqueIps: row[1],
                activatedIps: row[2] || '', // Puede estar vacío
                expirationDate: row[3],
                ebookUrl: row[4]
            }));
            res.json(licenses);
        } else {
            res.json([]); // No hay licencias o solo encabezados
        }
    } catch (error) {
        console.error('Error al obtener licencias:', error.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor al obtener licencias.' });
    }
});

// --- ENDPOINT: Obtener todos los usuarios ---
app.get('/users', async (req, res) => {
    if (!sheets) return res.status(503).json({ success: false, message: "Servicio de Google Sheets no disponible." });
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${USERS_SHEET_NAME}!A:E`, // Columnas Nombre, Email, LastIP, License, LastAccess
        });
        const rows = response.data.values;
        if (rows && rows.length > 1) { // Si hay encabezados y datos
            const users = rows.slice(1).map(row => ({
                userName: row[0],
                userEmail: row[1],
                lastIp: row[2],
                licenseKey: row[3],
                lastAccess: row[4]
            }));
            res.json(users);
        } else {
            res.json([]); // No hay usuarios
        }
    } catch (error) {
        console.error('Error al obtener usuarios:', error.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor al obtener usuarios.' });
    }
});


// --- ENDPOINT: Modo de Mantenimiento ---
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
app.listen(port, () => {
    console.log(`Servidor de licencias escuchando en http://localhost:${port}`);
    initializeGoogleSheets(); // Inicializar la conexión a Google Sheets cuando el servidor esté listo
});