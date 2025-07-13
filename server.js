// server.js
require('dotenv').config(); // Carga las variables de entorno desde .env (solo para desarrollo local)
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const { google } = require('googleapis'); // Importa googleapis

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

let sheets; // Variable global para el cliente de Google Sheets API

// Función para autenticar y obtener el cliente de Google Sheets
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
    } catch (error) {
        console.error("Error al autenticar con Google Sheets:", error.message);
        // Opcional: Reintentar conexión después de un tiempo si la autenticación falla
        // setTimeout(authenticateGoogleSheets, 5000); 
    }
}

// Conectar a Google Sheets al iniciar el servidor
authenticateGoogleSheets();

// --- Middleware para obtener la IP del cliente ---
app.set('trust proxy', true); // Necesario para obtener la IP real detrás de un proxy (Render)

// --- Funciones de Utilidad para Google Sheets ---

// Lee todas las filas de una hoja y las convierte en un array de objetos
async function getSheetData(sheetName) {
    if (!sheets) throw new Error("Google Sheets API no inicializada.");
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetName}!A:Z`, // Lee hasta la columna Z para asegurar todos los datos
        });
        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return []; // No hay datos
        }

        const headers = rows[0]; // La primera fila son los encabezados
        const data = rows.slice(1).map(row => {
            let obj = {};
            headers.forEach((header, index) => {
                obj[header] = row[index] || ''; // Asigna valor o cadena vacía si es undefined
            });
            return obj;
        });
        return data;
    } catch (error) {
        console.error(`Error al leer datos de la hoja '${sheetName}':`, error);
        throw error;
    }
}

// Añade una nueva fila a la hoja
async function appendSheetRow(sheetName, rowData) {
    if (!sheets) throw new Error("Google Sheets API no inicializada.");
    try {
        const headers = await getSheetHeaders(sheetName); // Obtener encabezados dinámicamente
        const values = headers.map(header => rowData[header] || ''); // Mapear datos a los encabezados
        
        await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetName}!A1`, // Rango donde empezar a añadir (busca la primera fila vacía)
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

// Actualiza una fila existente en la hoja
async function updateSheetRow(sheetName, identifier, identifierValue, newRowData) {
    if (!sheets) throw new Error("Google Sheets API no inicializada.");
    try {
        const allRows = await getSheetData(sheetName); // Obtener todos los datos
        const headers = allRows.length > 0 ? Object.keys(allRows[0]) : [];

        const rowIndexToUpdate = allRows.findIndex(row => row[identifier] === identifierValue);
        
        if (rowIndexToUpdate === -1) {
            // Si no se encuentra, podemos optar por añadirla si es una actualización con 'upsert'
            console.warn(`No se encontró la fila con ${identifier}='${identifierValue}' para actualizar en ${sheetName}. Se intentará añadir.`);
            await appendSheetRow(sheetName, newRowData);
            return;
        }

        // Fila original del sheet, incluyendo los encabezados (rowIndexToUpdate + 1)
        const actualSheetRowIndex = rowIndexToUpdate + 2; // +1 por los encabezados, +1 por ser 1-indexed

        const existingRow = allRows[rowIndexToUpdate];
        const mergedRow = { ...existingRow, ...newRowData }; // Fusionar datos nuevos con existentes

        const values = headers.map(header => mergedRow[header] || '');

        await sheets.spreadsheets.values.update({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetName}!A${actualSheetRowIndex}`, // Rango de la fila específica a actualizar
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

// Obtiene los encabezados de una hoja
async function getSheetHeaders(sheetName) {
    if (!sheets) throw new Error("Google Sheets API no inicializada.");
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetName}!1:1`, // Leer solo la primera fila
        });
        return response.data.values[0] || [];
    } catch (error) {
        console.error(`Error al obtener encabezados de la hoja '${sheetName}':`, error);
        throw error;
    }
}

// --- Endpoint para OBTENER TODAS las Licencias (para el generador) ---
app.get('/licenses', async (req, res) => {
    if (!sheets) return res.status(503).json({ message: "Servicio de Google Sheets no disponible." });
    try {
        const licenses = await getSheetData(LICENSES_SHEET_NAME);
        // Asegúrate de que activatedIps sea un array para el cliente
        licenses.forEach(lic => {
            lic.activatedIps = lic.activatedIps ? lic.activatedIps.split(',') : [];
            lic.isValid = lic.isValid === 'true'; // Convertir string 'true'/'false' a booleano
            lic.maxUniqueIps = parseInt(lic.maxUniqueIps, 10);
        });
        res.json(licenses);
    } catch (error) {
        res.status(500).json({ message: "Error interno del servidor al obtener licencias." });
    }
});

// --- Endpoint para OBTENER TODOS los Datos de Usuario (para el generador/admin) ---
app.get('/users', async (req, res) => {
    if (!sheets) return res.status(503).json({ message: "Servicio de Google Sheets no disponible." });
    try {
        const users = await getSheetData(USERS_SHEET_NAME);
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: "Error interno del servidor al obtener datos de usuarios." });
    }
});

// --- Endpoint para el Generador de Licencias ---
app.post('/generate-license', async (req, res) => {
    if (!sheets) return res.status(503).json({ success: false, message: "Servicio de Google Sheets no disponible." });
    
    const newLicenseKey = uuidv4(); 
    const maxUniqueIps = req.body.maxUniqueIps ? parseInt(req.body.maxUniqueIps, 10) : 1;

    if (isNaN(maxUniqueIps) || maxUniqueIps < 1) {
        return res.status(400).json({ success: false, message: "El límite de IPs únicas debe ser un número entero positivo." });
    }

    const licenseData = {
        licenseKey: newLicenseKey,
        maxUniqueIps: maxUniqueIps.toString(), // Guardar como string
        activatedIps: '',                      // Inicialmente vacío
        lastUsed: '',
        isValid: 'true',                       // Guardar como string 'true'
        createdAt: new Date().toISOString()
    };

    try {
        await appendSheetRow(LICENSES_SHEET_NAME, licenseData);
        console.log(`Licencia generada y añadida: ${newLicenseKey} (Máx IPs únicas: ${maxUniqueIps})`);
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

        if (licenseToUpdate.isValid === 'false') {
            return res.status(200).json({ success: true, message: "La licencia ya estaba invalidada." });
        }

        // Actualiza el campo isValid
        const newLicenseData = { isValid: 'false' };
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

        if (licenseData.isValid === 'false') { // Compara con el string 'false' de la hoja
            console.log(`Intento de validación con clave invalidada: '${incomingLicenseKey}'. IP: ${clientIp}`);
            return res.status(403).json({ valid: false, message: "Esta licencia ha sido invalidada y ya no es válida." });
        }
        
        // Convertir activatedIps a array para la lógica, y maxUniqueIps a número
        let activatedIpsArray = licenseData.activatedIps ? licenseData.activatedIps.split(',') : [];
        const maxUniqueIpsNum = parseInt(licenseData.maxUniqueIps, 10);

        const isIpAlreadyActivated = activatedIpsArray.includes(clientIp);

        if (isIpAlreadyActivated) {
            // Solo actualizamos el timestamp de último uso
            await updateSheetRow(LICENSES_SHEET_NAME, 'licenseKey', incomingLicenseKey, { lastUsed: new Date().toISOString() });
            console.log(`Licencia '${incomingLicenseKey}' re-validada por IP: ${clientIp}. IPs únicas usadas: ${activatedIpsArray.length}/${maxUniqueIpsNum}`);
            res.json({ valid: true, message: "Licencia válida." });
        } else {
            if (activatedIpsArray.length < maxUniqueIpsNum) {
                activatedIpsArray.push(clientIp);
                const newActivatedIpsString = activatedIpsArray.join(',');
                // Añadir nueva IP y actualizar timestamp
                await updateSheetRow(LICENSES_SHEET_NAME, 'licenseKey', incomingLicenseKey, {
                    activatedIps: newActivatedIpsString,
                    lastUsed: new Date().toISOString()
                });
                console.log(`Licencia '${incomingLicenseKey}' activada por nueva IP: ${clientIp}. IPs únicas usadas: ${activatedIpsArray.length}/${maxUniqueIpsNum}`);
                res.json({ valid: true, message: "Licencia válida y activada para esta IP." });
            } else {
                console.log(`Licencia '${incomingLicenseKey}' ha alcanzado su límite de ${maxUniqueIpsNum} IPs únicas. Intento de uso por IP: ${clientIp}`);
                res.status(403).json({ valid: false, message: `Esta licencia ya ha sido activada por su número máximo de ${maxUniqueIpsNum} IPs diferentes.` });
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
            firstAccess: existingUser ? existingUser.firstAccess : timestamp // Mantener el primer acceso si ya existe
        };

        if (existingUser) {
            // Si el usuario existe, actualiza su fila
            await updateSheetRow(USERS_SHEET_NAME, 'userEmail', userEmail, userData);
            console.log(`Datos de usuario actualizados para ${userEmail}.`);
        } else {
            // Si el usuario no existe, inserta una nueva fila
            await appendSheetRow(USERS_SHEET_NAME, userData);
            console.log(`Nuevo usuario registrado: ${userEmail}.`);
        }
        
        res.status(200).json({ success: true, message: "Datos de usuario registrados." });

    } catch (error) {
        console.error("Error al registrar datos de usuario en Sheets:", error);
        res.status(500).json({ success: false, message: "Error interno del servidor al registrar datos de usuario." });
    }
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