// server.js

const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000; // Puerto del servidor

// Middleware
// --- Configuración de CORS ---
app.use(cors({
    origin: 'https://ebook-nutricion-frontend.onrender.com', // <--- ¡CAMBIA ESTO A TU DOMINIO EXACTO DEL FRONTEND!
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json()); // Para parsear el body de las peticiones JSON

// Configuración de autenticación para Google Sheets
const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

// Función para registrar una nueva licencia en Google Sheets
async function registerLicense(licenseKey, userName, userEmail) { // userIp eliminado de los parámetros
    try {
        const response = await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Licenses!A:E', // Ajusta el rango si las columnas de IP ya no existen
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [
                    [licenseKey, false, new Date().toISOString(), userName, userEmail] // userIp eliminado de los valores
                ],
            },
        });
        console.log('Licencia registrada:', response.data);
        return true;
    } catch (error) {
        console.error('Error al registrar la licencia:', error.response ? error.response.data : error.message);
        return false;
    }
}

// Función para registrar un nuevo usuario
async function registerUser(userName, userEmail, licenseKey) { // userIp eliminado de los parámetros
    try {
        const response = await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Users!A:D', // Ajusta el rango si las columnas de IP ya no existen
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [
                    [userName, userEmail, new Date().toISOString(), licenseKey] // userIp eliminado de los valores
                ],
            },
        });
        console.log('Usuario registrado:', response.data);
        return true;
    } catch (error) {
        console.error('Error al registrar el usuario:', error.response ? error.response.data : error.message);
        return false;
    }
}

// Función para verificar la existencia y el estado de la licencia
async function checkLicense(licenseKey) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Licenses!A:B', // Rango para obtener la clave y el estado
        });
        const rows = response.data.values;
        if (rows) {
            // Buscar la licencia y verificar su estado
            const licenseRow = rows.find(row => row[0] === licenseKey);
            if (licenseRow) {
                const isActive = licenseRow[1] === 'TRUE' || licenseRow[1] === 'true'; // El segundo elemento (índice 1) es el estado
                return { exists: true, isActive: isActive };
            }
        }
        return { exists: false, isActive: false };
    } catch (error) {
        console.error('Error al verificar la licencia:', error.response ? error.response.data : error.message);
        return { exists: false, isActive: false };
    }
}

// Función para activar una licencia
async function activateLicense(licenseKey) {
    try {
        // Primero, encontrar la fila de la licencia
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Licenses!A:A', // Solo la columna de licencias
        });
        const rows = response.data.values;
        if (rows) {
            const rowIndex = rows.findIndex(row => row[0] === licenseKey);
            if (rowIndex !== -1) {
                const sheetRow = rowIndex + 1; // Las filas de Google Sheets son 1-indexadas

                // Actualizar la columna 'Activa' (asumiendo que es la columna B)
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `Licenses!B${sheetRow}`, // Columna B para el estado 'Activa'
                    valueInputOption: 'USER_ENTERED',
                    resource: {
                        values: [
                            ['TRUE']
                        ],
                    },
                });
                return true;
            }
        }
        return false; // Licencia no encontrada
    } catch (error) {
        console.error('Error al activar la licencia:', error.response ? error.response.data : error.message);
        return false;
    }
}


// Ruta para validar y registrar la licencia
app.post('/validate-and-register-license', async (req, res) => {
    const { license, userName, userEmail } = req.body; // userIp eliminado del destructuring

    // Validar que los parámetros básicos estén presentes (userIp ya no se valida)
    if (!license || !userName || !userEmail) {
        return res.status(400).json({ success: false, message: 'Faltan parámetros: licencia, userName o userEmail.' });
    }

    try {
        const licenseStatus = await checkLicense(license);

        if (licenseStatus.exists) {
            if (licenseStatus.isActive) {
                // Licencia válida y ya activa
                return res.status(200).json({ success: true, message: 'Licencia válida y activa.' });
            } else {
                // Licencia válida pero inactiva, activarla
                const activated = await activateLicense(license);
                if (activated) {
                    // Registrar el usuario asociado a esta activación (si no existe ya)
                    // Puedes añadir aquí una lógica para no duplicar usuarios si ya están registrados
                    await registerUser(userName, userEmail, license); // userIp eliminado de la llamada
                    return res.status(200).json({ success: true, message: 'Licencia activada con éxito.' });
                } else {
                    return res.status(500).json({ success: false, message: 'Error al activar la licencia.' });
                }
            }
        } else {
            // Licencia no válida
            return res.status(401).json({ success: false, message: 'Clave de licencia no válida.' });
        }
    } catch (error) {
        console.error('Error en la ruta /validate-and-register-license:', error);
        return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

// Ruta de estado de mantenimiento (opcional, para verificar si el servicio está online)
app.get('/get-maintenance-status', (req, res) => {
    // Aquí puedes implementar lógica para verificar si el servidor está en mantenimiento
    // Por ahora, simplemente responde que está activo
    res.status(200).json({ status: 'active', message: 'Servidor de licencias activo.' });
});


// Manejo de errores 404
app.use((req, res, next) => {
    res.status(404).send("Lo siento, no se pudo encontrar esa ruta.");
});

// Manejo de errores generales
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Algo salió mal en el servidor.');
});

// Iniciar el servidor
app.listen(port, () => {
    console.log(`Servidor escuchando en http://localhost:${port}`);
});